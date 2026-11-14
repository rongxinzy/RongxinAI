import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { expect, test, vi } from 'vitest';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { installTestMagpie } from '../../../../tests/helpers/installTestMagpie';
import { CoworkExecutionMode, CoworkSessionMode } from '../../../shared/cowork/constants';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { agentResourceDiagnostics } from '../../agentResourceDiagnostics';
import { CoworkStore } from '../../coworkStore';
import { SqliteStore } from '../../sqliteStore';
import { initializeWorkbenchTaskSchema } from '../../workbenchTask/schema';
import { WorkbenchTaskService } from '../../workbenchTask/taskService';
import { runTextWorkerOperation } from '../../workbenchTask/textWorkerOperations';
import { PiRuntimeAdapter } from './piRuntimeAdapter';
import { piSessionDirFor } from './piSessionStore';
import { PiAssistantStopReason } from './piToolConstants';

// Only Electron's unbuilt worker transport is replaced. The adapter, SDK,
// provider HTTP parser, tools, SQLite and JSONL are real.
vi.mock('../../workbenchTask/artifactWorkerPool', () => ({
  transformCoworkTextAsync: async (input: Parameters<typeof runTextWorkerOperation>[0]) =>
    runTextWorkerOperation(input),
}));

const Scenario = { Restore: 'restore', SummaryFailure: 'summary-failure' } as const;
const markers = Array.from(
  { length: 48 },
  (_, index) => `EVIDENCE_${String(index).padStart(3, '0')}`,
);

test.each([
  { window: 65536, scenario: Scenario.Restore, terminal: PiAssistantStopReason.Stop },
  { window: 262144, scenario: Scenario.Restore, terminal: PiAssistantStopReason.Stop },
  { window: 65536, scenario: Scenario.Restore, terminal: PiAssistantStopReason.Error },
  { window: 65536, scenario: Scenario.SummaryFailure, terminal: PiAssistantStopReason.Stop },
  { window: 65536, scenario: Scenario.SummaryFailure, terminal: PiAssistantStopReason.Length },
])(
  'resumes a genuinely oversized persisted session: $window $scenario $terminal',
  async configuration => {
    const root = await mkdtemp(path.join(tmpdir(), 'pi-oversized-resume-'));
    const workspace = path.join(root, 'workspace');
    const sessionId = 'oversized-history';
    const modelId = 'resume-model';
    let summaryCalls = 0;
    let regularCalls = 0;
    let writeCalls = 0;
    let failSummary = configuration.scenario === Scenario.SummaryFailure;
    const serverErrors: unknown[] = [];
    const requests: Array<{ summary: boolean; input: number; output: number }> = [];
    const server = createServer((req, res) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString()) as {
          messages: unknown[];
          max_tokens?: number;
          max_completion_tokens?: number;
        };
        const text = JSON.stringify(body.messages);
        const summary = text.includes('context summarization assistant');
        // Enforce an independent server budget against actual payload size, not
        // invented high usage attached to a tiny prompt. Over-limit calls fail.
        const input = Math.ceil(text.length / 3);
        const output = body.max_tokens ?? body.max_completion_tokens ?? 0;
        requests.push({ summary, input, output });
        if (requests.length > 120) throw new Error('Unexpected recovery loop');
        if (input + output > configuration.window) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'maximum context length exceeded' } }));
          return;
        }
        if (summary) summaryCalls++;
        else regularCalls++;
        const partial = summary && failSummary && summaryCalls === 2;
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
              content: summary
                ? found.join(' ') || 'Continue the task.'
                : 'Recovered artifact verified.',
            };
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({ id: 'resume', model: modelId, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
        );
        res.end(
          `data: ${JSON.stringify({
            id: 'resume',
            model: modelId,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: partial ? 'length' : write ? 'tool_calls' : 'stop',
              },
            ],
            usage: { prompt_tokens: input, completion_tokens: 200, total_tokens: input + 200 },
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
      const mutableApp = app as unknown as Record<string, unknown>;
      mutableApp.getAppPath ??= () => process.cwd();
      await mkdir(workspace);
      await mkdir(path.join(root, 'state'));
      store = await SqliteStore.create(path.join(root, 'state'));
      const db = store.getDatabase();
      initializeWorkbenchTaskSchema(db);
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
      const manager = SessionManager.create(workspace, piSessionDirFor(root, sessionId));
      // Around 420K locally estimated input: larger than both tested windows.
      for (const marker of markers) {
        manager.appendMessage({
          role: 'user',
          content: `${marker}\n${'historical evidence '.repeat(1800)}`,
          timestamp: 1,
        });
        manager.appendMessage({
          role: 'assistant',
          content: [{ type: 'text', text: 'Recorded.' }],
          timestamp: 2,
          api: 'openai-completions',
          provider: 'magpie',
          model: modelId,
          stopReason:
            marker === markers.at(-1) ? configuration.terminal : PiAssistantStopReason.Stop,
          errorMessage:
            configuration.terminal === PiAssistantStopReason.Error && marker === markers.at(-1)
              ? 'Context window exceeded: estimated input 406565 leaves no output budget in 65536 tokens'
              : undefined,
          // Old/failed sessions may have no useful usage. Recovery must inspect history.
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        });
      }
      const file = manager.getSessionFile()!;
      const original = await readFile(file, 'utf8');
      const errors: unknown[] = [];
      let complete = 0;
      adapter.on('error', (_id, error) => errors.push(error));
      adapter.on('complete', () => {
        complete++;
      });
      adapter.on('permissionRequest', (_id, request) => {
        adapter.respondToPermission(request.requestId, { behavior: 'allow' });
      });
      const resume = () =>
        adapter.continueSession(
          sessionId,
          'Continue the old task. Write all evidence markers, in order, to recovered.md.',
          {
            workspaceRoot: workspace,
            sessionMode: CoworkSessionMode.Work,
            approvalMode: WorkbenchApprovalMode.Ask,
          },
        );
      if (failSummary) {
        await expect(resume()).rejects.toThrow('summary is incomplete');
        expect(summaryCalls).toBe(2);
        expect(regularCalls).toBe(0);
        expect(complete).toBe(0);
        expect(errors).toHaveLength(1);
        expect((await readFile(file, 'utf8')).startsWith(original)).toBe(true);
        const failedBranch = SessionManager.open(file).getBranch();
        expect(failedBranch.filter(entry => entry.type === 'message')).toEqual(
          manager.getBranch().filter(entry => entry.type === 'message'),
        );
        expect(
          failedBranch.some(entry => entry.type === 'compaction' || entry.type === 'context_edit'),
        ).toBe(false);
        await expect(readFile(path.join(workspace, 'recovered.md'))).rejects.toThrow();
        failSummary = false;
        errors.length = 0;
      }
      await resume();
      expect(errors).toEqual([]);
      expect(complete).toBe(1);
      expect(summaryCalls).toBeGreaterThan(1);
      expect(await readFile(path.join(workspace, 'recovered.md'), 'utf8')).toBe(markers.join('\n'));
      expect(
        requests
          .filter(request => !request.summary)
          .every(request => request.input + request.output <= configuration.window),
      ).toBe(true);
      expect(requests.every(request => request.output > 1)).toBe(true);
      const persisted = SessionManager.open(file);
      expect(persisted.getBranch().some(entry => entry.type === 'compaction')).toBe(true);
      // Compaction adds a projection; the original source remains available intact.
      expect((await readFile(file, 'utf8')).startsWith(original)).toBe(true);
      expect(restored).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          source: 'jsonl',
          messageCount: 96,
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
