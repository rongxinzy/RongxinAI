import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { app } from 'electron';
import { expect, test, vi } from 'vitest';

import { ArtifactLedger } from '../../src/main/artifactLedger/artifactLedger';
import { CoworkStore } from '../../src/main/coworkStore';
import { SqliteStore } from '../../src/main/sqliteStore';
import { PiRuntimeAdapter } from '../../src/main/libs/agentEngine/piRuntimeAdapter';
import { resolvePiSessionStoreFile } from '../../src/main/libs/agentEngine/piSessionStore';
import { CoworkExecutionMode, CoworkSessionMode } from '../../src/shared/cowork/constants';
import { WorkbenchApprovalMode } from '../../src/shared/workbenchTask';
import { createTestMagpie } from '../helpers/createTestMagpie';

// Real Pi SDK, native write tool, SQLite and JSONL. Only Electron and model
// inference are substitutes: deterministic SSE is served on loopback, not by
// an external model. This is not GUI or live-provider acceptance.
const mutableApp = app as unknown as Record<string, unknown>;
if (typeof mutableApp.getAppPath !== 'function') mutableApp.getAppPath = () => process.cwd();

interface ModelRequest {
  messages: Array<{
    role: string;
    content?: unknown;
    tool_call_id?: string;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  }>;
}

function expectStructuredWriteHistory(request: ModelRequest, callId: string, filename: string) {
  const call = request.messages
    .flatMap(message => message.tool_calls ?? [])
    .find(tool => tool.id === callId);
  expect(call?.function.name).toBe('write');
  expect(JSON.parse(call!.function.arguments)).toMatchObject({ path: filename });
  const result = request.messages.find(
    message => message.role === 'tool' && message.tool_call_id === callId,
  );
  expect(result).toBeDefined();
  expect(JSON.stringify(result!.content)).toContain(filename);
}

async function readEntries(file: string): Promise<SessionEntry[]> {
  return (await readFile(file, 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as SessionEntry)
    .filter(entry => entry.type === 'message');
}

test(
  'relocates idle Pi writes and retains native history across recreation and reopen',
  {
    timeout: 60_000,
  },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pi-workspace-relocation-'));
    const workspaceA = path.join(root, 'a');
    const workspaceB = path.join(root, 'b');
    const sessionRoot = path.join(root, 'native-sessions');
    const model = 'offline-workspace-relocation';
    const writes = [
      { path: 'first.txt', content: 'written in A' },
      { path: 'second.txt', content: 'written in B' },
      { path: 'reopened.txt', content: 'written after reopening B' },
    ];
    const requests: ModelRequest[] = [];
    const errors: string[] = [];
    const permissions: string[] = [];
    let completions = 0;
    const upstream = createServer(async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const request = JSON.parse(Buffer.concat(chunks).toString()) as ModelRequest;
        const index = requests.push(request) - 1;
        const turn = Math.floor(index / 2);
        const action = index % 2 === 0 ? writes[turn] : undefined;
        if (turn >= writes.length) throw new Error('Unexpected extra model request');
        const delta = action
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: `relocate-write-${turn + 1}`,
                  type: 'function',
                  function: { name: 'write', arguments: JSON.stringify(action) },
                },
              ],
            }
          : { role: 'assistant', content: `Finished turn ${turn + 1}.` };
        const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          chunk({
            id: `response-${index}`,
            object: 'chat.completion.chunk',
            model,
            choices: [{ index: 0, delta, finish_reason: null }],
          }),
        );
        res.end(
          chunk({
            id: `response-${index}`,
            object: 'chat.completion.chunk',
            model,
            choices: [{ index: 0, delta: {}, finish_reason: action ? 'tool_calls' : 'stop' }],
            usage: { prompt_tokens: 1024, completion_tokens: 64, total_tokens: 1088 },
          }) + 'data: [DONE]\n\n',
        );
      } catch (error) {
        errors.push(String(error));
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: String(error) } }));
      }
    });
    let store: SqliteStore | undefined;
    let gateway: ReturnType<typeof createTestMagpie> | undefined;
    let runtime: PiRuntimeAdapter | undefined;
    try {
      await mkdir(workspaceA);
      await mkdir(workspaceB);
      await mkdir(path.join(root, 'database'));
      await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
      gateway = createTestMagpie({
        gatewayUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
        defaultModelId: model,
      });
      gateway.upsert(model, { context_window: 65536, max_output_tokens: 8192 });
      store = await SqliteStore.create(path.join(root, 'database'));
      const ledger = new ArtifactLedger(store.getDatabase());
      const cowork = new CoworkStore(store.getDatabase(), ledger);
      const adapter = new PiRuntimeAdapter({
        modelService: gateway.modelService,
        artifactLedger: ledger,
        coworkStore: cowork,
        piSessionStoreRoot: sessionRoot,
      });
      runtime = adapter;
      adapter.on('error', (_sessionId, error) => errors.push(`runtime:${error.kind}`));
      adapter.on('complete', () => {
        completions += 1;
      });
      adapter.on('permissionRequest', (_sessionId, request) => {
        permissions.push(request.toolName);
        adapter.respondToPermission(request.requestId, { behavior: 'allow' });
      });
      const session = cowork.createSession(
        'Workspace relocation',
        workspaceA,
        '',
        CoworkExecutionMode.Local,
        [],
        'main',
        '',
        CoworkSessionMode.Work,
        'workspace-relocation-session',
      );
      store.getDatabase().exec(`CREATE TEMP TRIGGER reject_persisted_liveness
        BEFORE UPDATE OF status ON cowork_sessions WHEN NEW.status = 'running'
        BEGIN SELECT RAISE(ABORT, 'Pi liveness must stay in memory'); END;`);
      const piHistoryKey = cowork.getPiHistoryKey(session.id);
      const resolvePiHistory = () =>
        resolvePiSessionStoreFile(sessionRoot, session.id, undefined, piHistoryKey);
      const options = {
        sessionMode: CoworkSessionMode.Work,
        approvalMode: WorkbenchApprovalMode.Ask,
      };
      const firstTurn = adapter.startSession(
        session.id,
        'Write first.txt in the current directory.',
        {
          ...options,
          workspaceRoot: workspaceA,
        },
      );
      try {
        expect(adapter.getRunningSessionIds()).toEqual([session.id]);
        expect(() =>
          cowork.workspaces.relocateWorkspace(
            session.workspaceId,
            workspaceB,
            'Moved project',
            adapter.getRunningSessionIds(),
          ),
        ).toThrow('while a session is running');
      } finally {
        await firstTurn;
      }
      expect(errors).toEqual([]);
      expect(completions).toBe(1);
      expect(adapter.isSessionRunning(session.id)).toBe(false);
      expect(adapter.isSessionActive(session.id)).toBe(true);
      expect(await readFile(path.join(workspaceA, 'first.txt'), 'utf8')).toBe(writes[0].content);
      const original = adapter.activeSessions.get(session.id)!;
      expect(original.artifactRecorder).not.toBeNull();
      const originalRecorder = original.artifactRecorder!;
      const disposeOriginal = vi.spyOn(originalRecorder, 'dispose');
      await originalRecorder.settled();
      expect(ledger.list(session.id).map(artifact => artifact.filePath)).toContain(
        path.join(workspaceA, 'first.txt'),
      );
      const { sessionFile: file } = await resolvePiHistory();
      expect(file).not.toBeNull();
      const firstEntries = await readEntries(file!);
      expect(
        firstEntries.some(
          entry =>
            entry.type === 'message' &&
            entry.message.role === 'toolResult' &&
            entry.message.toolName === 'write',
        ),
      ).toBe(true);

      // Relocate the existing workspace through its real store entry point, not
      // a new session or a direct mutation of active.workspaceRoot.
      const relocated = cowork.workspaces.relocateWorkspace(
        session.workspaceId,
        workspaceB,
        'Moved project',
        adapter.getRunningSessionIds(),
      );
      const stored = cowork.getSession(session.id, 0, { includeArtifacts: false })!;
      expect(stored.cwd).toBe(workspaceB);
      expect(stored.workspaceId).toBe(relocated!.id);
      const onSettled = vi.fn();
      await adapter.continueSession(session.id, 'Write second.txt in the current directory.', {
        ...options,
        workspaceRoot: stored.cwd,
        onSettled,
      });
      expect(errors).toEqual([]);
      expect(onSettled).toHaveBeenCalledExactlyOnceWith({ ok: true, output: 'Finished turn 2.' });
      const secondDestinations = await Promise.all(
        [workspaceA, workspaceB].map(directory =>
          readFile(path.join(directory, 'second.txt'), 'utf8').catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') return null;
              throw error;
            },
          ),
        ),
      );
      expect(secondDestinations).toEqual([null, writes[1].content]);
      expect(adapter.activeSessions.get(session.id)).not.toBe(original);
      expect(adapter.activeSessions.get(session.id)?.workspaceRoot).toBe(workspaceB);
      expect(disposeOriginal).toHaveBeenCalledTimes(1);
      const relocatedRecorder = adapter.activeSessions.get(session.id)!.artifactRecorder;
      expect(relocatedRecorder).not.toBeNull();
      expect(relocatedRecorder).not.toBe(originalRecorder);
      await relocatedRecorder!.settled();
      const artifactPaths = ledger.list(session.id).map(artifact => artifact.filePath);
      expect(artifactPaths).toContain(path.join(workspaceB, 'second.txt'));
      expect(artifactPaths).not.toContain(path.join(workspaceA, 'second.txt'));
      await expect(resolvePiHistory()).resolves.toMatchObject({
        sessionFile: file,
      });
      expect((await readEntries(file!)).slice(0, firstEntries.length)).toEqual(firstEntries);
      expectStructuredWriteHistory(requests[2], 'relocate-write-1', 'first.txt');

      adapter.stopSession(session.id);
      await adapter.continueSession(session.id, 'Write reopened.txt in the current directory.', {
        ...options,
        workspaceRoot: stored.cwd,
      });
      expect(errors).toEqual([]);
      expect(completions).toBe(3);
      expect(onSettled).toHaveBeenCalledTimes(1);
      expect(requests).toHaveLength(6);
      expect(permissions).toEqual(['write', 'write', 'write']);
      expect(await readFile(path.join(workspaceB, 'reopened.txt'), 'utf8')).toBe(writes[2].content);
      await expect(readFile(path.join(workspaceA, 'reopened.txt'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expectStructuredWriteHistory(requests[4], 'relocate-write-1', 'first.txt');
      expectStructuredWriteHistory(requests[4], 'relocate-write-2', 'second.txt');
      await expect(resolvePiHistory()).resolves.toMatchObject({
        sessionFile: file,
      });
      expect((await readEntries(file!)).slice(0, firstEntries.length)).toEqual(firstEntries);
    } finally {
      runtime?.stopAllSessions();
      vi.restoreAllMocks();
      store?.close();
      await new Promise<void>(resolve => {
        upstream.close(() => resolve());
        upstream.closeAllConnections();
      });
      await rm(root, { recursive: true, force: true });
    }
  },
);
