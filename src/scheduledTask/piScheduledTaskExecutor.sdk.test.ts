import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { app } from 'electron';

import { createTestMagpie } from '../../tests/helpers/createTestMagpie';
import { createCoworkSessionDeletion } from '../main/coworkSessionDeletion';
import { CoworkStore } from '../main/coworkStore';
import { IMStore } from '../main/im/imStore';
import { PiRuntimeAdapter } from '../main/libs/agentEngine/piRuntimeAdapter';
import { piSessionDirFor } from '../main/libs/agentEngine/piSessionStore';
import { ProjectMemoryService } from '../main/memory/projectMemoryService';
import { resolveProjectIdentity } from '../main/memory/projectIdentity';
import { MemoryRepository } from '../main/memory/repository';
import { SqliteStore } from '../main/sqliteStore';
import { WorkbenchTaskService } from '../main/workbenchTask/taskService';
import { DeliveryMode, PayloadKind, ScheduleKind, SessionTarget, WakeMode } from './constants';
import { PiScheduledTaskExecutor } from './piScheduledTaskExecutor';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';

const mockApp = app as unknown as Record<string, unknown>;
if (typeof mockApp.getAppPath !== 'function') mockApp.getAppPath = () => process.cwd();

test('reopened scheduled history supplies context only while its Cowork session still exists', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'zhiyuan-scheduled-output-'));
  const model = 'scheduled-output';
  const requests: string[] = [];
  const upstream = createServer(async (req, res) => {
    const chunks = await Array.fromAsync(req);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { messages: unknown[] };
    requests.push(JSON.stringify(body.messages));
    const content = requests.length === 1 ? 'Previous scheduled answer.' : '';
    const chunk = (delta: unknown, finishReason: string | null) =>
      `data: ${JSON.stringify({ id: `run-${requests.length}`, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(chunk({ role: 'assistant', content }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const gateway = createTestMagpie({
    gatewayUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    defaultModelId: model,
  });
  gateway.upsert(model, { context_window: 65_536, max_output_tokens: 4096 });
  const sqlite = await SqliteStore.create(directory);
  const db = sqlite.getDatabase();
  const coworkStore = new CoworkStore(db);
  const scheduledStore = new SqliteScheduledTaskStore(db);
  const failures: string[] = [];
  const createAdapter = () => {
    const runtime = new PiRuntimeAdapter({
      modelService: gateway.modelService,
      coworkStore,
      piSessionStoreRoot: directory,
    });
    runtime.on('error', (_id, error) => failures.push(error.message));
    return runtime;
  };
  let adapter = createAdapter();
  try {
    const workspace = coworkStore.workspaces.ensureWorkspace(directory);
    const task = scheduledStore.create({
      name: 'Scheduled output',
      description: '',
      enabled: true,
      schedule: { kind: ScheduleKind.Every, everyMs: 60_000 },
      sessionTarget: SessionTarget.Task,
      wakeMode: WakeMode.Now,
      payload: { kind: PayloadKind.AgentTurn, message: 'Respond if needed.', timeoutSeconds: 15 },
      delivery: { mode: DeliveryMode.None },
      workspaceId: workspace.id,
    });
    const sessionId = `scheduled-task:${task.id}`;
    const execute = (minute: number) => {
      const run = scheduledStore.claimTrigger({
        taskId: task.id,
        scheduleVersion: task.scheduleVersion!,
        scheduledAt: new Date(Date.UTC(2030, 0, 1, 0, minute)).toISOString(),
      })!;
      return new PiScheduledTaskExecutor(adapter, coworkStore).execute(task, run);
    };
    await expect(execute(0)).resolves.toEqual({
      sessionId,
      output: 'Previous scheduled answer.',
    });
    await expect(execute(1)).resolves.toEqual({ sessionId, output: null });

    adapter.stopAllSessions();
    adapter = createAdapter();
    await expect(execute(2)).resolves.toEqual({ sessionId, output: null });
    expect(requests[2]).toContain('Previous scheduled answer.');
    expect(coworkStore.getSession(sessionId)?.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ content: 'Previous scheduled answer.' })]),
    );

    const oldKey = coworkStore.getPiHistoryKey(sessionId);
    expect(oldKey).toEqual(expect.any(String));
    const oldDirectory = piSessionDirFor(directory, sessionId, oldKey);
    const workbench = new WorkbenchTaskService(db);
    const deleteSessions = createCoworkSessionDeletion({
      getCoworkStore: () => coworkStore,
      getIMStore: () => new IMStore(db),
      getWorkbenchTaskService: () => workbench,
      getProjectMemoryService: () =>
        new ProjectMemoryService(
          new MemoryRepository(db),
          {} as never,
          resolveProjectIdentity,
          directory,
        ),
      forgetSession: (id, key) => adapter.onSessionDeleted(id, key),
    });
    const rename = fs.renameSync;
    const failingDetach = vi.spyOn(fs, 'renameSync').mockImplementation((target, destination) => {
      if (target === oldDirectory)
        throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
      return rename(target, destination);
    });
    try {
      await expect(deleteSessions({ ids: [sessionId] })).resolves.toEqual([sessionId]);
      expect(failingDetach).toHaveBeenCalledWith(oldDirectory, expect.any(String));
    } finally {
      failingDetach.mockRestore();
    }
    expect(coworkStore.getSession(sessionId)).toBeNull();
    expect(coworkStore.getPiHistoryKey(sessionId)).toBeUndefined();
    expect(fs.readdirSync(oldDirectory)).toEqual(
      expect.arrayContaining([expect.stringMatching(/\.jsonl$/)]),
    );

    adapter.stopAllSessions();
    adapter = createAdapter();
    await expect(execute(3)).resolves.toEqual({ sessionId, output: null });
    expect(coworkStore.getPiHistoryKey(sessionId)).toEqual(expect.any(String));
    expect(coworkStore.getPiHistoryKey(sessionId)).not.toBe(oldKey);
    expect(requests).toHaveLength(4);
    expect(requests[3]).not.toContain('Previous scheduled answer.');
    expect(failures).toEqual([]);
  } finally {
    adapter.stopAllSessions();
    await sqlite.close();
    await new Promise<void>(resolve => {
      upstream.close(() => resolve());
      upstream.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  }
});
