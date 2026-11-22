import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  contentText,
  normalizeContext,
  type AssistantMessage,
  type Model,
  type TextContent,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import {
  completeBoundedSummary,
  computePiCompactionDefaults,
  installPiCompactionSettingsGuard,
  installPiSessionManagerGuards,
} from './piBoundedCompaction';

function makeModel(contextWindow: number, maxTokens = 4096): Model<'openai-completions'> {
  return {
    id: 'budget-model',
    name: 'Budget Model',
    api: 'openai-completions',
    provider: 'magpie',
    baseUrl: 'http://127.0.0.1:8080/v1',
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow,
    maxTokens,
  };
}

function makeAssistantMessage(
  text = 'condensed',
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    provider: 'magpie',
    model: 'budget-model',
    stopReason: 'stop',
    timestamp: Date.now(),
    usage: {
      input: 100,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 110,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    ...overrides,
  };
}

test('computePiCompactionDefaults and installPiCompactionSettingsGuard scale budgets and preserve overrides', () => {
  expect(computePiCompactionDefaults(1024)).toEqual({
    reserveTokens: 256,
    keepRecentTokens: 512,
  });
  expect(computePiCompactionDefaults(65_536)).toEqual({
    reserveTokens: 16_384,
    keepRecentTokens: 20_000,
  });

  const settings = SettingsManager.inMemory();
  installPiCompactionSettingsGuard(settings);
  const small = makeModel(1024);
  expect(settings.getCompactionSettings(small)).toEqual({
    enabled: true,
    reserveTokens: 256,
    keepRecentTokens: 512,
  });
  expect(settings.getCompactionSettings(makeModel(65_536)).reserveTokens).toBe(16_384);

  settings.applyOverrides({
    compaction: {
      reserveTokens: 64,
      modelOverrides: { 'magpie/budget-model': { keepRecentTokens: 100 } },
    },
  });
  expect(settings.getCompactionSettings(small)).toEqual({
    enabled: true,
    reserveTokens: 64,
    keepRecentTokens: 100,
  });
});

test('installPiCompactionSettingsGuard calibrates keepRecentTokens for CJK density and overflow pressure', () => {
  const manager = SessionManager.inMemory(process.cwd());
  for (let i = 0; i < 16; i++) {
    manager.appendMessage({
      role: 'user',
      content: '数据库事务日志索引调度一致性故障恢复'.repeat(30),
      timestamp: 10,
    });
    manager.appendMessage(
      makeAssistantMessage('已记录。', {
        timestamp: 20,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }),
    );
  }
  const settings = SettingsManager.inMemory();
  installPiCompactionSettingsGuard(settings, () => manager);
  const resolved = settings.getCompactionSettings(makeModel(32_768));
  expect(resolved.reserveTokens).toBe(8192);
  expect(resolved.keepRecentTokens).toBeLessThan(6000);
  expect(resolved.keepRecentTokens).toBeGreaterThan(0);
});

test('installPiSessionManagerGuards normalizes legacy strings without altering JSONL, zeroes stale usage, and enforces monotonic timestamps', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pi-session-guards-'));
  try {
    const manager = SessionManager.create(dir, dir);
    manager.appendMessage({ role: 'user', content: 'turn 1', timestamp: 100 });
    manager.appendMessage(
      makeAssistantMessage('Recorded.', {
        timestamp: 200,
        usage: {
          input: 60000,
          output: 100,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 60100,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }),
    );
    const firstUserId = manager.getBranch()[0]!.id;
    const compactionId = manager.appendCompaction('summary', firstUserId, 60100);
    const compactionMs = new Date(manager.getEntry(compactionId)!.timestamp).getTime();

    const file = manager.getSessionFile()!;
    const raw = (await readFile(file, 'utf8')).replace(
      '"content":[{"type":"text","text":"Recorded."}]',
      '"content":"Recorded."',
    );
    await writeFile(file, raw);

    const reopened = SessionManager.open(file, dir, dir);
    installPiSessionManagerGuards(reopened);

    // Disk file stays untouched.
    expect(await readFile(file, 'utf8')).toBe(raw);

    // In-memory assistant content is array-normalized and stale pre-compaction usage is zeroed.
    const projection = reopened.buildSessionProjection();
    const staleAssistant = projection.messages.find(
      m => m.role === 'assistant',
    ) as AssistantMessage;
    expect(Array.isArray(staleAssistant.content)).toBe(true);
    expect(contentText(staleAssistant.content as TextContent[])).toBe('Recorded.');
    expect(staleAssistant.usage.totalTokens).toBe(0);

    // Raw entry usage stays preserved for billing/diagnostics.
    const rawAssistant = reopened
      .getBranch()
      .find(e => e.type === 'message' && e.message.role === 'assistant');
    expect(
      rawAssistant?.type === 'message' ? rawAssistant.message.usage.totalTokens : undefined,
    ).toBe(60100);

    // Post-compaction assistant message at same or earlier ms gets compactionMs + 1.
    const nextAssistant = makeAssistantMessage('after', { timestamp: compactionMs });
    reopened.appendMessage(nextAssistant);
    expect(nextAssistant.timestamp).toBe(compactionMs + 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('completeBoundedSummary splits on word boundaries, rejects length-truncated chunks, and stops at single-newline floor', async () => {
  const inputs: string[] = [];
  const source = `${'a'.repeat(2000)} MARKER_ABCDEF ${'b'.repeat(2000)}`;
  const buildCtx = (text: string): TranscriptContext =>
    normalizeContext({ messages: [{ role: 'user', content: text, timestamp: 0 }] });

  const merged = await completeBoundedSummary(makeModel(1024), source, buildCtx, async request => {
    const msg = request.messages.find(m => m.role === 'user')!;
    inputs.push(contentText(msg.content as TextContent[]));
    return makeAssistantMessage('condensed');
  });
  expect(contentText(merged.content as TextContent[])).toBe('condensed');
  expect(inputs.length).toBeGreaterThan(1);
  expect(inputs.some(text => text.includes('MARKER_ABCDEF'))).toBe(true);

  await expect(
    completeBoundedSummary(makeModel(4096), 'chunk1 chunk2', buildCtx, async () =>
      makeAssistantMessage('partial', { stopReason: 'length' }),
    ),
  ).rejects.toThrow('summary is incomplete');

  let newlineRequests = 0;
  await expect(
    completeBoundedSummary(
      makeModel(8192),
      'x\ny',
      text => buildCtx(`${text}\n\n# Instructions\nSummarize.`),
      async request => {
        const text = contentText(request.messages[0]!.content as TextContent[]);
        const start = text.startsWith('This is a contiguous excerpt')
          ? text.indexOf('\n\n') + 2
          : 0;
        const excerpt = text.slice(start, text.lastIndexOf('\n\n# Instructions'));
        if (excerpt === '\n') {
          newlineRequests++;
          return makeAssistantMessage('', {
            stopReason: 'error',
            errorMessage: 'Context window exceeded',
          });
        }
        return excerpt.includes('\n')
          ? makeAssistantMessage('', {
              stopReason: 'error',
              errorMessage: 'Context window exceeded',
            })
          : makeAssistantMessage('condensed');
      },
    ),
  ).rejects.toThrow('Summary instructions leave no room for source text in the model context');
  expect(newlineRequests).toBe(1);
});
