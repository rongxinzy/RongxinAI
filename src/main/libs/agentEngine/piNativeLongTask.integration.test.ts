import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { Type } from 'typebox';
import { DurableSession } from './durableSession.mjs';
import { DurableModelCatalog } from './durableModelCatalog.mjs';
import { getZhiyuanProductPreamble } from './piPromptOverrides';

// Installed Durable, a real local HTTP provider, native compaction and native
// tool tasks execute every step. There is no test AgentSession or continuation loop.
test.each(['threshold', 'overflow'] as const)(
  'native Durable finishes 32 HTTP tool rounds across %s compaction',
  async reason => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'durable-native-long-'));
    let completed = 0;
    let summaries = 0;
    let overflowSent = false;
    const serverErrors: unknown[] = [];
    const requests: Array<{ summary: boolean; input: number; maxTokens: number }> = [];
    const server = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const transcript = JSON.stringify(body.messages);
        const summary = transcript.includes('context summarization assistant');
        const input = Math.ceil(transcript.length / 3.5);
        requests.push({
          summary,
          input,
          maxTokens: body.max_tokens ?? body.max_completion_tokens ?? 0,
        });
        if (requests.length > 100) throw new Error('Unexpected native model loop');
        if (!summary) {
          expect(transcript).toContain(getZhiyuanProductPreamble());
          expect(transcript).toContain('You are the assigned specialist.');
          expect(transcript).not.toContain('You are a coding assistant running inside pi');
        }
        const overflow = !summary && reason === 'overflow' && completed === 6 && !overflowSent;
        if (overflow) {
          overflowSent = true;
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              error: { message: 'context_length_exceeded: maximum context length exceeded' },
            }),
          );
          return;
        }
        if (summary) summaries++;
        const tool = !summary && completed < 32;
        const delta = tool
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: `step-${completed + 1}`,
                  type: 'function',
                  function: {
                    name: 'record_step',
                    arguments: JSON.stringify({ step: completed + 1 }),
                  },
                },
              ],
            }
          : {
              role: 'assistant',
              content: summary
                ? `Verified steps 1-${completed}. Next step ${completed + 1}. Goal: 32 verified files.`
                : 'All 32 files are verified.',
            };
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(
          `data: ${JSON.stringify({ id: 'audit', model: 'audit', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
        );
        response.end(
          `data: ${JSON.stringify({
            id: 'audit',
            model: 'audit',
            choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }],
            usage: { prompt_tokens: input, completion_tokens: 64, total_tokens: input + 64 },
          })}\n\ndata: [DONE]\n\n`,
        );
      })().catch(error => {
        serverErrors.push(error);
        response.destroy();
      });
    });
    let session: DurableSession | undefined;
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
      const model = {
        id: 'audit',
        name: 'Audit',
        provider: 'native-audit',
        api: 'openai-completions',
        baseUrl,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 16384,
        maxTokens: 1024,
      };
      const catalog = new DurableModelCatalog();
      catalog.registerProvider(model.provider, { api: model.api, baseUrl, models: [model] });
      await catalog.setRuntimeApiKey(model.provider, 'offline-test');
      session = await DurableSession.open({
        cwd,
        durableFile: path.join(cwd, 'native.sqlite'),
        model,
        modelRuntime: catalog,
        resourceLoader: {
          extensions: [],
          getSystemPrompt: () => `${getZhiyuanProductPreamble()}\nYou are the assigned specialist.`,
          getSkills: () => ({ skills: [], diagnostics: [] }),
          reload: async () => {},
        },
        tools: ['record_step'],
        customTools: [
          {
            name: 'record_step',
            label: 'Record step',
            description: 'Record the next verified step.',
            parameters: Type.Object({ step: Type.Number() }),
            execute: async (_id, value) => {
              expect(value.step).toBe(completed + 1);
              completed = value.step;
              await writeFile(path.join(cwd, `step-${completed}.txt`), `verified ${completed}`);
              return {
                content: [
                  {
                    type: 'text',
                    text: `Completed ${completed}. ${'evidence '.repeat(reason === 'overflow' && completed <= 6 ? 2 : 2500)}`,
                  },
                ],
                details: {},
              };
            },
          },
        ],
      });
      const events: string[] = [];
      const compactions: string[] = [];
      session.subscribe(event => {
        events.push(event.type);
        if (event.type === 'compaction_end' && event.result)
          compactions.push(String((event.result as { reason?: string }).reason));
      });
      // Fixed Date proves recovery does not require wall-clock progress.
      vi.useFakeTimers({ toFake: ['Date'] });
      await session.prompt('Create and verify 32 files.');
      expect(serverErrors).toEqual([]);
      expect(completed).toBe(32);
      expect(summaries).toBeGreaterThan(1);
      expect(compactions).toContain(reason);
      expect(events.filter(event => event === 'agent_settled')).toHaveLength(1);
      expect((await readdir(cwd)).filter(name => /^step-\d+\.txt$/.test(name))).toHaveLength(32);
      expect(await readFile(path.join(cwd, 'step-32.txt'), 'utf8')).toBe('verified 32');
      expect(requests.every(request => request.maxTokens > 1)).toBe(true);
      if (reason === 'overflow') expect(overflowSent).toBe(true);
    } finally {
      vi.useRealTimers();
      await session?.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(cwd, { recursive: true, force: true });
    }
  },
  30000,
);
