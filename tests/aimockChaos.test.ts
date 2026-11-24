/**
 * L2 chaos lane: drive the real Pi adapter stack against aimock fixtures that
 * inject provider faults — 429 rate limits, mid-stream disconnects, unknown
 * tool names, invalid tool-call arguments. Each probe runs a two-tool-call
 * conversation (read → write → final text); recovery must still produce
 * out.md, misbehavior must be contained without wedging the session.
 */

import os from 'node:os';
import path from 'node:path';
import { LLMock, type Fixture, type MockServerOptions } from '@copilotkit/aimock';
import { describe, expect, it } from 'vitest';

import { runAdapterProbe, type AdapterProbeResult } from './replay/adapterBench';

const PROMPT = '读取 data/probe.txt 的内容并写入 out.md。';
const HARD_CAP_MS = 120_000;

const readFixture = (overrides: Partial<Fixture> = {}): Fixture => ({
  match: { userMessage: PROMPT, hasToolResult: false },
  response: {
    toolCalls: [{ name: 'read', arguments: JSON.stringify({ path: 'data/probe.txt' }) }],
  },
  ...overrides,
});

const writeFixture: Fixture = {
  match: { toolResultContains: '探针文件内容' },
  response: {
    toolCalls: [
      {
        name: 'write',
        arguments: JSON.stringify({ path: 'out.md', content: '探针摘要输出' }),
      },
    ],
  },
};

const finalFixture: Fixture = {
  match: { toolResultContains: 'out.md' },
  response: { content: '已完成。' },
};

async function runProbe(
  fixtures: Fixture[],
  mockOptions: Partial<MockServerOptions> = {},
): Promise<AdapterProbeResult> {
  const mock = new LLMock({ port: 0, logLevel: 'warn', ...mockOptions });
  for (const fixture of fixtures) mock.addFixture(fixture);
  await mock.start();
  try {
    const url = new URL(mock.url);
    return await runAdapterProbe({
      providerBaseUrl: `${mock.url}/v1`,
      providerPort: Number(url.port),
      workDir: path.join(os.tmpdir(), 'aimock-probe-work'),
      prompt: PROMPT,
      hardCapMs: HARD_CAP_MS,
    });
  } finally {
    await mock.stop();
  }
}

describe('Pi adapter chaos (aimock)', () => {
  it(
    'recovers from a 429 rate limit and finishes the task',
    { timeout: HARD_CAP_MS + 60_000 },
    async () => {
      const result = await runProbe([
        {
          match: { userMessage: PROMPT, hasToolResult: false, sequenceIndex: 0 },
          response: { error: { message: 'rate limited', type: 'rate_limit_error' }, status: 429 },
        },
        readFixture({
          match: { userMessage: PROMPT, hasToolResult: false, sequenceIndex: 1 },
        }),
        writeFixture,
        finalFixture,
      ]);
      expect(result.outcome.status).toBe('complete');
      expect(result.fileExists('out.md')).toBe(true);
    },
  );

  it(
    'does not finalize on a mid-stream disconnect',
    { timeout: HARD_CAP_MS + 60_000 },
    async () => {
      const result = await runProbe([
        {
          match: { userMessage: PROMPT, hasToolResult: false, sequenceIndex: 0 },
          response: { content: '这个回复会在流式传输中途断开……'.repeat(20) },
          truncateAfterChunks: 1,
        },
        readFixture({
          match: { userMessage: PROMPT, hasToolResult: false, sequenceIndex: 1 },
        }),
        writeFixture,
        finalFixture,
      ]);
      // Acceptable outcomes: the stack retries and completes, or surfaces a
      // clean error. Never a silent "complete" without the tool work done.
      if (result.outcome.status === 'complete') {
        expect(result.fileExists('out.md')).toBe(true);
      } else {
        expect(result.outcome.status).toBe('error');
        expect(result.errors.length).toBeGreaterThan(0);
      }
    },
  );

  // Observed product gap: when all content chunks arrive but the stream's
  // terminator ([DONE] / finish_reason) is lost to a late socket close, the
  // adapter settles the run WITHOUT an error and without completing the
  // scripted tool work. Encoded as it.fails so the suite stays green while
  // the gap is tracked; a fix that surfaces or recovers from the truncation
  // flips this red as an unexpected pass.
  it.fails(
    'settles silently when the stream terminator is lost after full content',
    { timeout: HARD_CAP_MS + 60_000 },
    async () => {
      const result = await runProbe([
        {
          match: { userMessage: PROMPT, hasToolResult: false, sequenceIndex: 0 },
          response: { content: '这个回复会在流式传输中途断开……' },
          disconnectAfterMs: 100,
        },
        readFixture({
          match: { userMessage: PROMPT, hasToolResult: false, sequenceIndex: 1 },
        }),
        writeFixture,
        finalFixture,
      ]);
      if (result.outcome.status === 'complete') {
        expect(result.fileExists('out.md')).toBe(true);
      } else {
        expect(result.outcome.status).toBe('error');
        expect(result.errors.length).toBeGreaterThan(0);
      }
    },
  );

  it(
    'contains an unknown-tool misbehavior',
    { timeout: HARD_CAP_MS + 60_000 },
    async () => {
      const result = await runProbe(
        [
          {
            match: { userMessage: PROMPT, hasToolResult: false },
            response: {
              toolCalls: [{ name: 'read', arguments: JSON.stringify({ path: 'data/probe.txt' }) }],
            },
            misbehavior: {
              faults: [{ fault: 'tool-unknown-name', name: 'no_such_tool', times: 1, rate: 1 }],
            },
          },
          {
            // The adapter answers the bogus call with a tool-level error; the
            // next request carries that result and gets the real read call.
            match: { toolResultContains: 'no_such_tool' },
            response: {
              toolCalls: [{ name: 'read', arguments: JSON.stringify({ path: 'data/probe.txt' }) }],
            },
          },
          writeFixture,
          finalFixture,
        ],
        { enableMisbehavior: true },
      );
      expect(result.outcome.status).toBe('complete');
      expect(result.fileExists('out.md')).toBe(true);
    },
  );

  it(
    'contains invalid tool-call arguments',
    { timeout: HARD_CAP_MS + 60_000 },
    async () => {
      const result = await runProbe(
        [
          {
            match: { userMessage: PROMPT, hasToolResult: false },
            response: {
              toolCalls: [{ name: 'read', arguments: JSON.stringify({ path: 'data/probe.txt' }) }],
            },
            misbehavior: {
              faults: [{ fault: 'tool-args-invalid-json', times: 1, rate: 1 }],
            },
          },
          {
            // First tool result on this conversation is the argument parse
            // failure; answer it with a well-formed read retry.
            match: { hasToolResult: true, sequenceIndex: 0 },
            response: {
              toolCalls: [{ name: 'read', arguments: JSON.stringify({ path: 'data/probe.txt' }) }],
            },
          },
          writeFixture,
          finalFixture,
        ],
        { enableMisbehavior: true },
      );
      expect(result.outcome.status).toBe('complete');
      expect(result.fileExists('out.md')).toBe(true);
    },
  );
});
