import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { expect, test, vi } from 'vitest';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai';
import {
  AssistantEntry,
  CompactionEntry,
  Harness,
  UserEntry,
  createRegistry,
} from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { installTestMagpie } from '../../../../tests/helpers/installTestMagpie';
import { CoworkExecutionMode, CoworkSessionMode } from '../../../shared/cowork/constants';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { agentResourceDiagnostics } from '../../agentResourceDiagnostics';
import { CoworkStore } from '../../coworkStore';
import { SqliteStore } from '../../sqliteStore';
import { WorkbenchTaskService } from '../../workbenchTask/taskService';
import { runTextWorkerOperation } from '../../workbenchTask/textWorkerOperations';
import { PiRuntimeAdapter } from './piRuntimeAdapter';
import { durableSessionFile } from './durableSessionStore';

// Replace only the unbuilt Electron worker transport. HTTP, native history,
// compaction, tool writes and application persistence all remain real.
vi.mock('../../workbenchTask/artifactWorkerPool', () => ({
  transformCoworkTextAsync: async (input: Parameters<typeof runTextWorkerOperation>[0]) =>
    runTextWorkerOperation(input),
}));
const context = BACKGROUND_CONTEXT;
const markers = Array.from(
  { length: 48 },
  (_, index) => `EVIDENCE_${String(index).padStart(3, '0')}`,
);
const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const configurations = [
  { window: 65536, terminal: 'stop', failSummary: false },
  { window: 262144, terminal: 'stop', failSummary: false },
  { window: 65536, terminal: 'error', failSummary: false },
  { window: 65536, terminal: 'stop', failSummary: true },
  { window: 65536, terminal: 'length', failSummary: true },
  { window: 65536, terminal: 'stop', failSummary: false, excessive: true },
] as const;

async function history(file: string, writable = false) {
  return Harness.open(
    await openNodeSqliteStorage(file),
    {
      models: createModels(),
      registry: createRegistry(),
      readOnly: !writable,
    },
    context,
  );
}
async function entries(file: string) {
  const native = await history(file);
  try {
    return (await (await native.root(context)).entries({}, 1000, undefined, context)).items;
  } finally {
    await native.close(context);
  }
}
function independentTokens(text: string) {
  const cjk = (
    text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []
  ).length;
  return cjk + Math.ceil((text.length - cjk) / 3.5);
}

test.each(configurations)(
  'native oversized resume: $window $terminal summaryFailure=$failSummary excessive=$excessive',
  async configuration => {
    const root = await mkdtemp(path.join(tmpdir(), 'durable-oversized-'));
    const workspace = path.join(root, 'workspace');
    const sessionId = 'oversized-history';
    const modelId = 'resume-model';
    let failSummary = configuration.failSummary as boolean;
    let summaryCalls = 0;
    let writeCalls = 0;
    const errors: unknown[] = [];
    let complete = 0;
    const serverErrors: unknown[] = [];
    const requests: Array<{ summary: boolean; input: number; output: number }> = [];
    const server = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const text = JSON.stringify(body.messages);
        const summary = text.includes('context summarization assistant');
        const input = independentTokens(text);
        const output = body.max_tokens ?? body.max_completion_tokens ?? 0;
        requests.push({ summary, input, output });
        if (requests.length > 30) throw new Error('Unexpected recovery loop');
        if (input + output > configuration.window) {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: { message: 'maximum context length exceeded' } }));
          return;
        }
        if (summary) summaryCalls++;
        const found = [...new Set(text.match(/EVIDENCE_\d{3}/g) ?? [])];
        const write = !summary && writeCalls === 0;
        if (write) writeCalls++;
        const delta = write
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'recovered-artifact',
                  type: 'function',
                  function: {
                    name: 'write',
                    arguments: JSON.stringify({ path: 'recovered.md', content: found.join('\n') }),
                  },
                },
              ],
            }
          : {
              role: 'assistant',
              content: summary ? found.join(' ') : 'Recovered artifact verified.',
            };
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(
          `data: ${JSON.stringify({ id: 'resume', model: modelId, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
        );
        response.end(
          `data: ${JSON.stringify({
            id: 'resume',
            model: modelId,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: summary && failSummary ? 'length' : write ? 'tool_calls' : 'stop',
              },
            ],
            usage: { prompt_tokens: input, completion_tokens: 200, total_tokens: input + 200 },
          })}\n\ndata: [DONE]\n\n`,
        );
      })().catch(error => {
        serverErrors.push(error);
        response.destroy();
      });
    });
    let store: SqliteStore | undefined;
    let gateway: ReturnType<typeof installTestMagpie> | undefined;
    const adapter = new PiRuntimeAdapter();
    const restored = vi.spyOn(agentResourceDiagnostics, 'recordPiHistoryRestored');
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      gateway = installTestMagpie({
        gatewayUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        defaultModelId: modelId,
        acceptUnknownModels: false,
      });
      gateway.upsert(modelId, { context_window: configuration.window, max_output_tokens: 4096 });
      gateway.setImage(modelId, false);
      (app as unknown as Record<string, unknown>).getAppPath ??= () => process.cwd();
      await mkdir(workspace);
      await mkdir(path.join(root, 'state'));
      store = await SqliteStore.create(path.join(root, 'state'));
      const db = store.getDatabase();
      const cowork = new CoworkStore(db);
      cowork.createSession(
        'Resume',
        workspace,
        '',
        CoworkExecutionMode.Local,
        [],
        'main',
        '',
        CoworkSessionMode.Work,
        sessionId,
      );
      adapter.setCoworkStore(cowork);
      adapter.setWorkbenchTaskService(new WorkbenchTaskService(db));
      adapter.setPiSessionStoreRoot(root);
      const file = durableSessionFile(root, sessionId);
      await mkdir(path.dirname(file), { recursive: true });
      const seed = await history(file, true);
      const conversation = await seed.root(context);
      const excessive = 'excessive' in configuration && configuration.excessive;
      // Actual CJK token payload exceeds both supported windows, independent of
      // reported usage (all historical usage is zero). The regular case still
      // has a summary prefix that fits; the excessive case deliberately does not.
      const chars = Math.ceil(
        (excessive ? configuration.window * 5 : configuration.window + 9000) / markers.length,
      );
      await seed.commit(async tx => {
        for (const marker of markers) {
          await tx.appendEntry(conversation.id, {
            kind: UserEntry.kind,
            model: [
              {
                role: 'user',
                content: `${marker}\n${'数据库事务日志索引调度一致性恢复'.repeat(Math.ceil(chars / '数据库事务日志索引调度一致性恢复'.length))}`,
                timestamp: 1,
              },
            ],
          });
          await tx.appendEntry(conversation.id, {
            kind: AssistantEntry.kind,
            model: [
              {
                role: 'assistant',
                content: [{ type: 'text', text: 'Recorded.' }],
                timestamp: 2,
                api: 'openai-completions',
                provider: 'magpie',
                model: modelId,
                usage,
                stopReason: marker === markers.at(-1) ? configuration.terminal : 'stop',
                ...(configuration.terminal === 'error'
                  ? { errorMessage: 'maximum context length exceeded' }
                  : {}),
              },
            ],
          });
        }
      }, context);
      await seed.close(context);
      const original = await entries(file);
      expect(independentTokens(JSON.stringify(original))).toBeGreaterThan(configuration.window);
      adapter.on('error', (_id, error) => errors.push(error));
      adapter.on('complete', () => {
        complete++;
      });
      adapter.on('permissionRequest', (_id, request) =>
        adapter.respondToPermission(request.requestId, { behavior: 'allow' }),
      );
      const resume = () =>
        adapter.continueSession(
          sessionId,
          'Continue the task. Write all evidence markers, in order, to recovered.md.',
          {
            workspaceRoot: workspace,
            sessionMode: CoworkSessionMode.Work,
            approvalMode: WorkbenchApprovalMode.Ask,
          },
        );
      if (failSummary || excessive) {
        await expect(resume()).rejects.toThrow(/compaction|summary|context/i);
        expect(complete).toBe(0);
        expect(errors.length).toBeGreaterThan(0);
        expect(writeCalls).toBe(0);
        expect(requests.filter(request => !request.summary)).toEqual([]);
        const failed = await entries(file);
        expect(failed.filter(entry => original.some(old => old.id === entry.id))).toEqual(original);
        expect(failed.some(entry => CompactionEntry.is(entry))).toBe(false);
        await expect(readFile(path.join(workspace, 'recovered.md'))).rejects.toThrow();
        if (excessive) {
          expect(serverErrors).toEqual([]);
          return;
        }
        failSummary = false;
        errors.length = 0;
      }
      await resume();
      expect(errors).toEqual([]);
      expect(complete).toBe(1);
      expect(summaryCalls).toBeGreaterThan(0);
      expect(await readFile(path.join(workspace, 'recovered.md'), 'utf8')).toBe(markers.join('\n'));
      expect(
        requests
          .filter(request => !request.summary)
          .every(request => request.input + request.output <= configuration.window),
      ).toBe(true);
      expect(requests.every(request => request.output > 1)).toBe(true);
      const persisted = await entries(file);
      expect(persisted.some(entry => CompactionEntry.is(entry))).toBe(true);
      expect(persisted.filter(entry => original.some(old => old.id === entry.id))).toEqual(
        original,
      );
      expect(restored).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          source: 'durable',
          messageCount: 50,
          contextWindow: configuration.window,
          model: modelId,
        }),
      );
      await adapter.stopAllSessions();
      await resume();
      expect(complete).toBe(2);
      expect(writeCalls).toBe(1);
      expect(errors).toEqual([]);
      expect(serverErrors).toEqual([]);
    } finally {
      await adapter.stopAllSessions();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      restored.mockRestore();
      gateway?.dispose();
      store?.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);
