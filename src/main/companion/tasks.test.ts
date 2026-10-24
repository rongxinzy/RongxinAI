import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { CompanionTasks } from './tasks';
import { createCoworkStoreHarness } from '../coworkStore/coworkStore.testHarness';
import { initializeWorkbenchTaskSchema } from '../workbenchTask/schema';
import { WorkbenchTaskService } from '../workbenchTask/taskService';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import {
  WorkbenchRunStatus,
  WorkbenchRunTrigger,
  WorkbenchTaskStatus,
} from '../../shared/workbenchTask';
import type { CoworkSessionIpcDeps } from '../coworkIpc/sessionStart';

vi.mock('../i18n', () => ({ t: (key: string) => key }));
vi.mock('../appBootstrap/sessionExperts', () => ({
  resolveCoworkPromptLanguage: () => 'zh',
  resolveSessionExpertSnapshots: () => [],
}));
vi.mock('../coworkPrompt/composer', () => ({
  composeCoworkSystemPrompt: ({ basePrompt }: { basePrompt: string }) => basePrompt,
}));

const close: (() => void)[] = [];
afterEach(() => {
  close.splice(0).forEach(callback => callback());
  vi.restoreAllMocks();
});

function fixture() {
  const { db, store } = createCoworkStoreHarness();
  close.push(() => db.close());
  initializeWorkbenchTaskSchema(db);
  const tasks = new WorkbenchTaskService(db);
  const workspace = store.ensureWorkspace('/tmp/companion-task-workspace');
  const start = vi.fn(async () => {});
  const stop = vi.fn();
  const sessions = {
    getCoworkStore: () => store,
    getAgentManager: () => ({ getAgent: () => null }),
    getPiRuntimeAdapter: () => ({ startSession: start, stopSession: stop, emit: vi.fn() }),
    getCoworkImageRoot: () => '/tmp/companion-task-images',
    resolveSessionWorkingDirectory: (input: { cwd?: string }) => input.cwd ?? '',
    resolveTaskWorkingDirectory: (cwd: string) => cwd,
  } as unknown as CoworkSessionIpcDeps;
  const models = {
    resolveAutomatic: vi.fn(async () => ({
      model: { id: 'available/model' },
      gatewayUrl: 'http://localhost',
    })),
  };
  const options = { db, sessions, models: models as never, tasks };
  const service = new CompanionTasks(options);
  const profile = {
    petId: '00000000-0000-4000-8000-000000000001',
    personaId: DesktopPetBuiltinId.Youli,
    characterId: DesktopPetBuiltinId.Xiaoyuan,
    createdAt: 1,
  };
  const request = {
    petId: profile.petId,
    requestId: 'one',
    text: 'Prepare a project report',
    workspaceId: workspace.id,
  };
  return { db, store, tasks, start, stop, models, options, service, profile, request };
}

test('commits session, message, task, run and receipt before the single native launch', async () => {
  const f = fixture();
  f.start.mockImplementation(
    async (
      sessionId?: string,
      _prompt?: string,
      options?: { _workbenchRunId: string; modelOverride: string; systemPrompt: string },
    ) => {
      expect(f.db.inTransaction).toBe(false);
      expect(f.db.prepare('SELECT count(*) AS n FROM companion_task_admissions').get()).toEqual({
        n: 1,
      });
      expect(f.store.getSession(sessionId!)?.messages[0].content).toBe(f.request.text);
      expect(f.tasks.getCurrent(sessionId!)?.runs[0].id).toBe(options!._workbenchRunId);
      expect(options?.modelOverride).toBe('available/model');
      expect(options?.systemPrompt).toContain('Youli');
    },
  );
  const first = await f.service.submit(f.profile, f.request);
  expect(first.receipt).toBeTruthy();
  const retry = await f.service.submit(f.profile, f.request);
  expect(retry).toEqual(first);
  expect(f.start).toHaveBeenCalledOnce();
  expect(f.models.resolveAutomatic).toHaveBeenCalledOnce();
  expect(f.service.recent(f.profile.petId)[0]).toMatchObject({
    receipt: first.receipt,
    status: WorkbenchRunStatus.Queued,
  });
  expect(f.service.recent('another-pet')).toEqual([]);
});

test('concurrent lost-reply retries commit only one task and reject a changed payload', async () => {
  const f = fixture();
  const results = await Promise.all([
    f.service.submit(f.profile, f.request),
    f.service.submit(f.profile, f.request),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(f.start).toHaveBeenCalledOnce();
  await expect(
    f.service.submit(f.profile, { ...f.request, text: 'Different task' }),
  ).rejects.toThrow('different input');
  await expect(
    f.service.submit({ ...f.profile, petId: '00000000-0000-4000-8000-000000000002' }, f.request),
  ).rejects.toThrow('another companion');
});

test('a preparation failure rolls back all canonical state without starting execution', async () => {
  const f = fixture();
  vi.spyOn(f.store, 'addMessage').mockImplementationOnce(() => {
    throw new Error('disk rejected');
  });
  await expect(f.service.submit(f.profile, f.request)).rejects.toThrow('disk rejected');
  for (const table of [
    'companion_task_admissions',
    'workbench_tasks',
    'workbench_runs',
    'cowork_sessions',
  ])
    expect(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
  expect(f.start).not.toHaveBeenCalled();
});

test('restart and session deletion preserve the original receipt and never replay the work', async () => {
  const f = fixture();
  const first = await f.service.submit(f.profile, f.request);
  const restored = new CompanionTasks(f.options);
  expect(await restored.submit(f.profile, f.request)).toEqual(first);
  expect(restored.recent(f.profile.petId)[0].status).toBe(WorkbenchRunStatus.Failed);
  f.db.prepare('DELETE FROM cowork_sessions WHERE id = ?').run(first.receipt!.sessionId);
  expect(await restored.submit(f.profile, f.request)).toEqual(first);
  expect(restored.recent(f.profile.petId)[0].missing).toBe(true);
  expect(f.start).toHaveBeenCalledOnce();
});

test('no model or invalid workspace leaves no accepted task', async () => {
  const f = fixture();
  f.models.resolveAutomatic.mockResolvedValue(null as never);
  expect((await f.service.submit(f.profile, f.request)).receipt).toBeNull();
  await expect(
    f.service.submit(f.profile, { ...f.request, workspaceId: 'missing' }),
  ).rejects.toThrow('Unknown task workspace');
  expect(f.start).not.toHaveBeenCalled();
  expect(f.db.prepare('SELECT count(*) AS n FROM cowork_sessions').get()).toEqual({ n: 0 });
});

test('an initialization rejection fails the owned run without creating a second attempt', async () => {
  const f = fixture();
  f.start.mockRejectedValue(new Error('provider unavailable'));
  const result = await f.service.submit(f.profile, f.request);
  await vi.waitFor(() =>
    expect(f.service.recent(f.profile.petId)[0].status).toBe(WorkbenchRunStatus.Failed),
  );
  expect((await f.service.submit(f.profile, f.request)).receipt).toEqual(result.receipt);
  expect(f.start).toHaveBeenCalledOnce();
});

test('stop uses the owned native session while foreign ownership cannot stop it', async () => {
  const f = fixture();
  const result = await f.service.submit(f.profile, f.request);
  expect(() => f.service.stop('another-pet', result.receipt!.sessionId)).toThrow(
    'another companion',
  );
  expect(f.stop).not.toHaveBeenCalled();
  f.service.stop(f.profile.petId, result.receipt!.sessionId);
  expect(f.stop).toHaveBeenCalledWith(result.receipt!.sessionId);
  expect(f.service.recent(f.profile.petId)[0].status).toBe(WorkbenchRunStatus.Cancelled);
  expect(f.start).toHaveBeenCalledOnce();
});

test('metadata reads preserve order across native status changes', async () => {
  const f = fixture();
  const { receipt } = await f.service.submit(f.profile, f.request);
  const before = f.service.snapshot(f.profile.petId);
  f.service.stop(f.profile.petId, receipt!.sessionId);
  const after = f.service.snapshot(f.profile.petId);
  expect(after.revision).toBeGreaterThan(before.revision);
  expect(before.tasks[0].status).toBe(WorkbenchRunStatus.Queued);
  expect(after.tasks[0].status).toBe(WorkbenchRunStatus.Cancelled);
  expect(f.service.snapshot('another-pet').tasks).toEqual([]);
});

test('a workbench retry remains the same task and projects the latest run after completion', async () => {
  const f = fixture();
  const { receipt } = await f.service.submit(f.profile, f.request);
  const first = f.tasks.getCurrent(receipt!.sessionId)!.task;
  f.tasks.beginRun({
    sessionId: first.sessionId,
    goal: first.goal,
    contract: first.contract,
    preparedRunId: receipt!.runId,
  });
  f.tasks.failRun(first.sessionId, { message: 'first attempt failed' });
  const next = f.tasks.prepareRun(first.id, WorkbenchRunTrigger.Retry);
  f.tasks.beginRun({
    sessionId: first.sessionId,
    goal: first.goal,
    contract: first.contract,
    preparedRunId: next.run.id,
  });
  f.tasks.repository.updateRunStatus(next.run.id, WorkbenchRunStatus.Verifying);
  f.tasks.repository.updateRunStatus(next.run.id, WorkbenchRunStatus.Succeeded);
  f.tasks.repository.updateTaskStatus(first.id, WorkbenchTaskStatus.Completed, null);
  const [projection] = f.service.recent(f.profile.petId);
  expect(projection.receipt.taskId).toBe(first.id);
  expect(projection.status).toBe(WorkbenchRunStatus.Succeeded);
  expect(f.db.prepare('SELECT count(*) AS n FROM workbench_tasks').get()).toEqual({ n: 1 });
});

test('a native folder choice becomes visible without exposing filesystem paths in its result', async () => {
  const f = fixture();
  const directory = await realpath(await mkdtemp('/tmp/companion-folder-choice-'));
  try {
    const hidden = f.store.ensureWorkspace(directory, 'Chosen project', true);
    expect(f.service.workspaces().find(item => item.id === hidden.id)).toBeUndefined();
    const selected = await f.service.chooseWorkspace(directory);
    expect(selected).toEqual({ id: hidden.id, name: 'Chosen project' });
    expect(f.service.workspaces()).toContainEqual(selected);
    await writeFile(directory + '/file.txt', 'fixture');
    await expect(f.service.chooseWorkspace(directory + '/file.txt')).rejects.toThrow(
      'must be a directory',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
