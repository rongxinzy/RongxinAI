import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { expect, test, vi } from 'vitest';
import { createModels } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  Harness,
  createRegistry,
  UserEntry,
  AssistantEntry,
  CompactionEntry,
} from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { installTestMagpie } from '../../../../tests/helpers/installTestMagpie';
import { CoworkExecutionMode } from '../../../shared/cowork/constants';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { CoworkStore } from '../../coworkStore';
import { SqliteStore } from '../../sqliteStore';
import { initializeWorkbenchTaskSchema } from '../../workbenchTask/schema';
import { WorkbenchTaskService } from '../../workbenchTask/taskService';
import { runTextWorkerOperation } from '../../workbenchTask/textWorkerOperations';
import { PiRuntimeAdapter } from './piRuntimeAdapter';
import { durableSessionFile } from './durableSessionStore';

// Vitest does not build the Electron worker bundle. Keep the real text worker operation;
// the session, provider transport, tools, native SQLite are all exercised.
vi.mock('../../workbenchTask/artifactWorkerPool', () => ({
  transformCoworkTextAsync: async (input: Parameters<typeof runTextWorkerOperation>[0]) =>
    runTextWorkerOperation(input),
}));

const Scenario = { Threshold: 'threshold', RepeatedLength: 'length' } as const;

test.each([Scenario.Threshold, Scenario.RepeatedLength])(
  'full adapter preserves native context recovery and honest completion: %s',
  async scenario => {
    const root = await mkdtemp(path.join(tmpdir(), 'pi-adapter-pressure-'));
    const sessionId = 'context-pressure';
    const modelId = 'context-pressure-model';
    const artifacts = [
      ...Array.from({ length: 32 }, (_, index) => `doc-${String(index + 1).padStart(3, '0')}.md`),
      'index.csv',
      'report.md',
    ];
    let calls = 0;
    let summaries = 0;
    let callsAtSummary = 0;
    const requests: Array<{ summary: boolean; maxTokens: number }> = [];
    const serverErrors: unknown[] = [];
    const server = createServer((req, res) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString()) as {
          max_tokens?: number;
          max_completion_tokens?: number;
        };
        const summary = JSON.stringify(body).includes('context summarization assistant');
        requests.push({ summary, maxTokens: body.max_tokens ?? body.max_completion_tokens ?? 0 });
        if (requests.length > 100) throw new Error('Unexpected request loop');
        if (summary) {
          summaries++;
          callsAtSummary = calls;
        }
        const truncated = !summary && scenario === Scenario.RepeatedLength;
        const tool = !summary && !truncated && calls < artifacts.length;
        const file = artifacts[calls];
        const delta = tool
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: `write-${++calls}`,
                  type: 'function',
                  function: {
                    name: 'write',
                    arguments: JSON.stringify({ path: file, content: `verified ${file}\n` }),
                  },
                },
              ],
            }
          : {
              role: 'assistant',
              content: summary
                ? `Written ${calls} files. Continue with file ${calls + 1}, finish all 34.`
                : truncated
                  ? '.'
                  : 'All artifacts written.',
            };
        // Independent provider counts recreate the CJK underestimation failure.
        // Including cache hits proves total prompt usage drives compaction.
        const input =
          summaries === 0 ? 63455 : summary ? 16000 : 3000 + (calls - callsAtSummary) * 7000;
        const output = truncated ? 1 : 279;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({ id: 'pressure', model: modelId, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
        );
        res.end(
          `data: ${JSON.stringify({
            id: 'pressure',
            model: modelId,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: truncated ? 'length' : tool ? 'tool_calls' : 'stop',
              },
            ],
            usage: {
              prompt_tokens: input,
              completion_tokens: output,
              total_tokens: input + output,
              prompt_tokens_details: { cached_tokens: Math.max(0, input - 4000) },
            },
          })}\n\ndata: [DONE]\n\n`,
        );
      })().catch(error => {
        serverErrors.push(error);
        res.destroy();
      });
    });
    let store: SqliteStore | undefined;
    let gateway: ReturnType<typeof installTestMagpie> | undefined;
    const adapter = new PiRuntimeAdapter();
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      gateway = installTestMagpie({
        gatewayUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        defaultModelId: modelId,
        acceptUnknownModels: false,
      });
      gateway.upsert(modelId, { context_window: 65536, max_output_tokens: 4096 });
      gateway.setImage(modelId, false);
      const mutableApp = app as unknown as Record<string, unknown>;
      mutableApp.getAppPath ??= () => process.cwd();
      await mkdir(path.join(root, 'state'));
      store = await SqliteStore.create(path.join(root, 'state'));
      const db = store.getDatabase();
      initializeWorkbenchTaskSchema(db);
      const cowork = new CoworkStore(db);
      cowork.createSession(
        'Pressure',
        root,
        '',
        CoworkExecutionMode.Local,
        [],
        'main',
        '',
        'work',
        sessionId,
      );
      adapter.setCoworkStore(cowork);
      adapter.setWorkbenchTaskService(new WorkbenchTaskService(db));
      adapter.setPiSessionStoreRoot(root);
      const native = await Harness.open(
        await openNodeSqliteStorage(durableSessionFile(root, sessionId)),
        { models: createModels(), registry: createRegistry() },
        BACKGROUND_CONTEXT,
      );
      const conversation = await native.root(BACKGROUND_CONTEXT);
      await native.commit(async tx => {
        for (let i = 0; i < 18; i++) {
          await tx.appendEntry(conversation.id, {
            kind: UserEntry.kind,
            model: [
              {
                role: 'user',
                content: '数据库事务日志索引调度一致性故障恢复'.repeat(160),
                timestamp: Date.now(),
              },
            ],
          });
          await tx.appendEntry(conversation.id, {
            kind: AssistantEntry.kind,
            model: [
              {
                role: 'assistant',
                content: [{ type: 'text', text: '已记录。' }],
                timestamp: Date.now(),
                api: 'openai-completions',
                provider: 'magpie',
                model: modelId,
                stopReason: 'stop',
                usage: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 0,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
              },
            ],
          });
        }
      }, BACKGROUND_CONTEXT);
      await native.close(BACKGROUND_CONTEXT);
      const errors: unknown[] = [];
      let complete = 0;
      adapter.on('error', (_id, error) => errors.push(error));
      adapter.on('complete', () => {
        complete++;
      });
      adapter.on('permissionRequest', (_id, request) => {
        adapter.respondToPermission(request.requestId, { behavior: 'allow' });
      });
      vi.useFakeTimers({ toFake: ['Date'] });
      const start = adapter.startSession(
        sessionId,
        'Create 32 document summaries, index.csv and report.md. Verify every artifact before completing.',
        {
          workspaceRoot: root,
          sessionMode: 'work',
          approvalMode: WorkbenchApprovalMode.Ask,
        },
      );
      if (scenario === Scenario.Threshold) await start;
      else await expect(start).rejects.toThrow('completion is incomplete');
      await vi.waitFor(() => expect(complete + errors.length).toBeGreaterThan(0), {
        timeout: 25000,
      });
      expect(serverErrors).toEqual([]);
      expect(requests.every(request => request.maxTokens > 1)).toBe(true);
      const persisted = await Harness.open(
        await openNodeSqliteStorage(durableSessionFile(root, sessionId)),
        { models: createModels(), registry: createRegistry(), readOnly: true },
        BACKGROUND_CONTEXT,
      );
      const entries = (
        await (
          await persisted.root(BACKGROUND_CONTEXT)
        ).entries({}, 1000, undefined, BACKGROUND_CONTEXT)
      ).items;
      await persisted.close(BACKGROUND_CONTEXT);
      if (scenario === Scenario.Threshold) {
        expect(entries.some(entry => CompactionEntry.is(entry))).toBe(true);
        expect(errors).toEqual([]);
        expect(complete).toBe(1);
        expect(summaries).toBeGreaterThan(2);
        for (const name of artifacts)
          expect(await readFile(path.join(root, name), 'utf8')).toBe(`verified ${name}\n`);
      } else {
        expect(complete).toBe(0);
        expect(errors).not.toHaveLength(0);
        // A truncated answer is a failed product turn, not another implicit model run.
        expect(requests.filter(request => !request.summary)).toHaveLength(1);
        expect((await readdir(root)).filter(name => artifacts.includes(name))).toEqual([]);
      }
    } finally {
      vi.useRealTimers();
      await adapter.stopAllSessions();
      // The UI usage projection is deferred to a zero-delay timer.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      gateway?.dispose();
      store?.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
);
