import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { CompanionTasks } from './tasks';
import { initializeCompanionSchema } from './schema';
import { CoworkStore } from '../coworkStore';
import { createCoworkStoreHarness } from '../coworkStore/coworkStore.testHarness';
import { ActivityService } from '../activity/activityService';
import { CodingRoomRepository } from '../codingAgent/codingRoomRepository';
import { initializeCodingAgentSchema } from '../codingAgent/schema';
import { initializeActivitySchema } from '../activity/schema';
import { initializeScheduledTaskSchema } from '../../scheduledTask/schema';
import { SqliteScheduledTaskStore } from '../../scheduledTask/sqliteScheduledTaskStore';
import { recoverInterruptedWork } from '../appBootstrap/recoverInterruptedWork';
import { lifecycleRuntime } from '../appBootstrap/lifecycleRuntimeState';
import { initializeWorkbenchTaskSchema } from '../workbenchTask/schema';
import { WorkbenchTaskService } from '../workbenchTask/taskService';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import {
  WorkbenchExecutionStatus,
  WorkbenchRunEventType,
  WorkbenchRunTrigger,
} from '../../shared/workbenchTask';
import type { CoworkSessionIpcDeps } from '../coworkIpc/sessionStart';
import type { PiStartOptions } from '../libs/agentEngine/piRuntimeTypes';
import { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';

vi.mock('../i18n', () => ({ t: (key: string) => key }));
vi.mock('../appBootstrap/sessionExperts', () => ({
  resolveCoworkPromptLanguage: () => 'zh',
  resolveSessionExpertSnapshots: () => [],
}));
vi.mock('../coworkPrompt/composer', () => ({
  composeCoworkSystemPrompt: ({ basePrompt }: { basePrompt: string }) => basePrompt,
}));
vi.mock('../libs/coworkEnv/applyApplicationRuntimeEnv', () => ({
  applyApplicationRuntimeEnv: async () => {},
}));
vi.mock('../libs/agentEngine/piRuntimeSessionState', async importOriginal => ({
  ...(await importOriginal<typeof import('../libs/agentEngine/piRuntimeSessionState')>()),
  getPiModules: async () => ({}),
}));

const close: (() => void)[] = [];
afterEach(() => {
  close.splice(0).forEach(callback => callback());
  lifecycleRuntime.isQuitting = false;
  vi.restoreAllMocks();
});

function fixture(databasePath?: string) {
  const { db, store } = createCoworkStoreHarness(databasePath);
  close.push(() => {
    if (db.open) db.close();
  });
  initializeWorkbenchTaskSchema(db);
  initializeCompanionSchema(db);
  initializeScheduledTaskSchema(db);
  initializeActivitySchema(db);
  const tasks = new WorkbenchTaskService(db);
  const workspace = store.workspaces.ensureWorkspace('/tmp/companion-task-workspace');
  const start = vi.fn(async (_sessionId: string, _prompt: string, _options?: PiStartOptions) => {});
  const stop = vi.fn();
  const sessions = {
    getCoworkStore: () => store,
    getWorkbenchTaskService: () => tasks,
    getAgentManager: () => ({ getAgent: () => null }),
    getPiRuntimeAdapter: () => ({ startSession: start, stopSession: stop, emit: vi.fn() }),
    getCoworkImageRoot: () => '/tmp/companion-task-images',
    resolveSessionWorkingDirectory: (input: { cwd?: string }) => input.cwd ?? '',
    resolveTaskWorkingDirectory: async (cwd: string) => cwd,
  } as unknown as CoworkSessionIpcDeps;
  const models = {
    resolveAutomatic: vi.fn(async () => ({
      modelId: 'available/model',
      imageInput: false,
    })),
  };
  const options = { db, sessions, models: models as never };
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

test('checks the directory before committing the task and launching Pi once', async () => {
  const f = fixture();
  f.start.mockImplementation(
    async (sessionId?: string, _prompt?: string, options?: PiStartOptions) => {
      expect(f.db.inTransaction).toBe(false);
      expect(f.db.prepare('SELECT count(*) AS n FROM companion_task_admissions').get()).toEqual({
        n: 1,
      });
      expect(f.store.getSession(sessionId!)?.messages[0].content).toBe(f.request.text);
      expect(f.tasks.getCurrent(sessionId!)?.runs[0].id).toBe(options!.workbenchReservation?.runId);
      expect(options?.modelOverride).toBe('available/model');
      expect(options?.systemPrompt).toContain('Youli');
    },
  );
  const entered = Promise.withResolvers<string>();
  const directoryCheck = Promise.withResolvers<void>();
  const resolveDirectory = vi
    .spyOn(f.options.sessions, 'resolveTaskWorkingDirectory')
    .mockImplementation(async cwd => {
      entered.resolve(cwd);
      await directoryCheck.promise;
      return cwd;
    });
  const submission = f.service.submit(f.profile, f.request);
  try {
    expect(await Promise.race([entered.promise, submission])).toBe('/tmp/companion-task-workspace');
    expect(f.db.inTransaction).toBe(false);
    expect(f.db.prepare('SELECT count(*) AS n FROM cowork_sessions').get()).toEqual({ n: 0 });
    expect(f.start).not.toHaveBeenCalled();
  } finally {
    directoryCheck.resolve();
  }
  const first = await submission;
  expect(first.receipt).toBeTruthy();
  const retry = await f.service.submit(f.profile, f.request);
  expect(retry).toEqual(first);
  expect(await f.service.submit(f.profile, { ...f.request, attachmentIds: [] })).toEqual(first);
  expect(f.start).toHaveBeenCalledOnce();
  expect(resolveDirectory).toHaveBeenCalledOnce();
  expect(f.models.resolveAutomatic).toHaveBeenCalledExactlyOnceWith(undefined, { work: true });
  expect(f.service.recent(f.profile.petId)[0]).toMatchObject({
    receipt: first.receipt,
    status: WorkbenchExecutionStatus.Queued,
  });
  expect(f.service.recent('another-pet')).toEqual([]);
  f.store.updateSession(first.receipt!.sessionId, { title: 'Renamed in Work' });
  const readSession = vi.spyOn(f.store, 'getSession');
  expect(f.service.recent(f.profile.petId)[0].title).toBe('Renamed in Work');
  expect(readSession).not.toHaveBeenCalled();
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

test('audit failure cannot prevent the owned native launch and reserved IDs can be recorded later', async () => {
  const f = fixture();
  const brokenAudit = vi.spyOn(f.tasks.repository, 'createRun').mockImplementationOnce(() => {
    throw new Error('audit table unavailable');
  });
  const result = await f.service.submit(f.profile, f.request);
  expect(result.receipt).not.toBeNull();
  expect(f.start).toHaveBeenCalledOnce();
  expect(f.tasks.getCurrent(result.receipt!.sessionId)).toBeNull();
  expect(f.store.getSession(result.receipt!.sessionId)?.messages[0].content).toBe(f.request.text);
  const options = f.start.mock.calls[0][2];
  expect(options).toMatchObject({
    workbenchReservation: { taskId: result.receipt!.taskId, runId: result.receipt!.runId },
  });
  brokenAudit.mockRestore();
  const recorded = f.tasks.beginRun({
    sessionId: result.receipt!.sessionId,
    goal: f.request.text,
    reservation: result.receipt!,
  });
  expect(recorded.task.id).toBe(result.receipt!.taskId);
  expect(recorded.run.id).toBe(result.receipt!.runId);
  expect((await f.service.submit(f.profile, f.request)).receipt).toEqual(result.receipt);
  expect(f.start).toHaveBeenCalledOnce();
});

test('a preparation failure rolls back all canonical state without starting execution', async () => {
  const f = fixture();
  vi.spyOn(f.store.messages, 'addMessage').mockImplementationOnce(() => {
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
  const directory = await mkdtemp(join(tmpdir(), 'companion-task-restart-'));
  const databasePath = join(directory, 'work.sqlite');
  const f = fixture(databasePath);
  let db = f.db;
  try {
    const first = await f.service.submit(f.profile, f.request);
    const receipt = first.receipt!;
    expect(f.tasks.repository.getRun(receipt.runId)?.status).toBe(WorkbenchExecutionStatus.Queued);
    db.close();

    db = new Database(databasePath);
    const store = new CoworkStore(db);
    const tasks = new WorkbenchTaskService(db);
    initializeCodingAgentSchema(db);
    expect(
      recoverInterruptedWork(
        db,
        tasks,
        new SqliteScheduledTaskStore(db),
        new ActivityService(db),
        new CodingRoomRepository(db),
      ).runs,
    ).toBe(1);
    const restored = new CompanionTasks({
      ...f.options,
      db,
      sessions: {
        ...f.options.sessions,
        getCoworkStore: () => store,
        getWorkbenchTaskService: () => tasks,
      },
    });
    expect(await restored.submit(f.profile, f.request)).toEqual(first);
    expect(restored.recent(f.profile.petId)[0]).toMatchObject({
      receipt,
      status: WorkbenchExecutionStatus.Cancelled,
      missing: false,
    });
    expect(tasks.repository.getRun(receipt.runId)?.failure).toEqual({
      reason: 'application_restart',
    });
    expect(tasks.getDetail(receipt.taskId)?.events.map(event => event.type)).toEqual([
      WorkbenchRunEventType.RunCreated,
      WorkbenchRunEventType.RunCancelled,
    ]);

    tasks.repository.deleteSessionDomainData([receipt.sessionId]);
    expect(store.deleteSessions([receipt.sessionId])).toBe(1);
    expect(await restored.submit(f.profile, f.request)).toEqual(first);
    expect(restored.recent(f.profile.petId)[0].missing).toBe(true);
    expect(f.start).toHaveBeenCalledOnce();
    expect(f.models.resolveAutomatic).toHaveBeenCalledOnce();
  } finally {
    if (db.open) db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('creating a task consumer preserves work admitted in the current process', async () => {
  const f = fixture();
  const result = await f.service.submit(f.profile, f.request);
  const before = f.tasks.getDetail(result.receipt!.taskId);
  const exec = vi.spyOn(f.db, 'exec');

  const consumer = new CompanionTasks(f.options);
  expect(exec).not.toHaveBeenCalled();
  expect(f.tasks.getDetail(result.receipt!.taskId)).toEqual(before);
  expect(consumer.recent(f.profile.petId)[0]).toMatchObject({
    receipt: result.receipt,
    status: WorkbenchExecutionStatus.Queued,
  });
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

test('a workspace removed during the directory check leaves no accepted task', async () => {
  const f = fixture();
  vi.spyOn(f.options.sessions, 'resolveTaskWorkingDirectory').mockImplementation(async cwd => {
    expect(f.store.workspaces.deleteWorkspace(f.request.workspaceId)).toBe(true);
    return cwd;
  });

  await expect(f.service.submit(f.profile, f.request)).rejects.toThrow(
    'coworkTaskWorkspaceChanged',
  );
  expect(f.service.recent(f.profile.petId)).toEqual([]);
  expect(f.start).not.toHaveBeenCalled();
  expect(f.db.prepare('SELECT count(*) AS n FROM cowork_sessions').get()).toEqual({ n: 0 });
});

test('a prompt without visible text is rejected before task admission', async () => {
  const f = fixture();
  await expect(f.service.submit(f.profile, { ...f.request, text: '\u200b' })).rejects.toThrow(
    'Prompt is required.',
  );
  expect(f.models.resolveAutomatic).not.toHaveBeenCalled();
  expect(f.service.recent(f.profile.petId)).toEqual([]);
});

test.each(['evictIdleSessions', 'getPiSessionStoreRoot'] as const)(
  'Pi records a launch failure at %s once for the admitted run',
  async operation => {
    const f = fixture();
    const runtime = new PiRuntimeAdapter({ store: f.store, workbenchTaskService: f.tasks });
    runtime.on('error', vi.fn());
    vi.spyOn(runtime, operation).mockImplementationOnce(() => {
      throw new Error('Pi initialization unavailable');
    });
    f.start.mockImplementation((sessionId, prompt, options) =>
      runtime.startSession(sessionId, prompt, options),
    );
    const failRun = vi.spyOn(f.tasks, 'failRun');
    const result = await f.service.submit(f.profile, f.request);
    await vi.waitFor(() =>
      expect(f.service.recent(f.profile.petId)[0].status).toBe(WorkbenchExecutionStatus.Failed),
    );
    expect((await f.service.submit(f.profile, f.request)).receipt).toEqual(result.receipt);
    expect(failRun).toHaveBeenCalledExactlyOnceWith(
      result.receipt!.sessionId,
      { message: 'Pi initialization unavailable' },
      result.receipt!.runId,
    );
    expect(f.start).toHaveBeenCalledOnce();
  },
);

test('stop uses the owned native session while foreign ownership cannot stop it', async () => {
  const f = fixture();
  const result = await f.service.submit(f.profile, f.request);
  const runtime = new PiRuntimeAdapter({ store: f.store, workbenchTaskService: f.tasks });
  f.stop.mockImplementation(sessionId => runtime.stopSession(sessionId));
  const duplicateLookup = vi.spyOn(f.tasks.repository, 'getLatestTaskForSession');
  expect(() => f.service.stop('another-pet', result.receipt!.sessionId)).toThrow(
    'another companion',
  );
  expect(f.stop).not.toHaveBeenCalled();
  f.service.stop(f.profile.petId, result.receipt!.sessionId);
  expect(f.stop).toHaveBeenCalledWith(result.receipt!.sessionId);
  expect(duplicateLookup).not.toHaveBeenCalled();
  expect(f.service.recent(f.profile.petId)[0].status).toBe(WorkbenchExecutionStatus.Cancelled);
  expect(f.tasks.repository.getRun(result.receipt!.runId)?.failure).toEqual({
    reason: 'The user stopped this run.',
  });
  expect(f.start).toHaveBeenCalledOnce();
});

test('metadata reads preserve order across native status changes', async () => {
  const f = fixture();
  const runtime = new PiRuntimeAdapter({ store: f.store, workbenchTaskService: f.tasks });
  f.stop.mockImplementation(sessionId => runtime.stopSession(sessionId));
  const { receipt } = await f.service.submit(f.profile, f.request);
  const before = f.service.snapshot(f.profile.petId);
  f.service.stop(f.profile.petId, receipt!.sessionId);
  const after = f.service.snapshot(f.profile.petId);
  expect(after.revision).toBeGreaterThan(before.revision);
  expect(before.tasks[0].status).toBe(WorkbenchExecutionStatus.Queued);
  expect(after.tasks[0].status).toBe(WorkbenchExecutionStatus.Cancelled);
  expect(f.service.snapshot('another-pet').tasks).toEqual([]);
});

test('reads the recent cards in two queries while retaining deleted admission receipts', async () => {
  const f = fixture();
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  const receipts = [];
  for (let index = 0; index < 13; index++) {
    const result = await f.service.submit(f.profile, { ...f.request, requestId: `${index}` });
    receipts.push(result.receipt!);
  }
  const deleted = receipts[12];
  f.tasks.repository.deleteSessionDomainData([deleted.sessionId]);
  f.store.deleteSessions([deleted.sessionId]);

  const statements = vi.spyOn(f.db, 'prepare');
  const cards = f.service.recent(f.profile.petId);
  expect(statements).toHaveBeenCalledTimes(2);
  expect(cards.map(card => card.receipt)).toEqual(receipts.slice(1).reverse());
  expect(cards[0]).toMatchObject({
    title: '',
    missing: true,
    status: WorkbenchExecutionStatus.Cancelled,
  });
  expect(cards[1]).toMatchObject({ missing: false, status: WorkbenchExecutionStatus.Queued });
});

test('a late start observation cannot reopen a cancelled companion receipt', async () => {
  const f = fixture();
  const runtime = new PiRuntimeAdapter({ store: f.store, workbenchTaskService: f.tasks });
  f.stop.mockImplementation(sessionId => runtime.stopSession(sessionId));
  const { receipt } = await f.service.submit(f.profile, f.request);
  f.service.stop(f.profile.petId, receipt!.sessionId);
  const before = f.tasks.getDetail(receipt!.taskId);
  expect(before?.task.status).toBe(WorkbenchExecutionStatus.Cancelled);
  expect(() =>
    f.tasks.beginRun({
      sessionId: receipt!.sessionId,
      goal: f.request.text,
      reservation: receipt!,
    }),
  ).toThrow('Prepared run is no longer active.');
  expect(f.tasks.getDetail(receipt!.taskId)).toEqual(before);
  expect((await f.service.submit(f.profile, f.request)).receipt).toEqual(receipt);
  expect(f.start).toHaveBeenCalledOnce();
});

test('model resolution finishing during quit cannot admit a companion task', async () => {
  const f = fixture();
  const selection = Promise.withResolvers<Awaited<ReturnType<typeof f.models.resolveAutomatic>>>();
  f.models.resolveAutomatic.mockReturnValueOnce(selection.promise);
  const submitted = f.service.submit(f.profile, f.request);
  lifecycleRuntime.isQuitting = true;
  selection.resolve({ modelId: 'available/model', imageInput: false });

  await expect(submitted).rejects.toThrow('shutting down');
  expect(f.start).not.toHaveBeenCalled();
  expect(f.service.recent(f.profile.petId)).toEqual([]);
  for (const table of ['cowork_sessions', 'cowork_messages', 'workbench_tasks', 'workbench_runs']) {
    expect(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
  }
});

test('a workbench retry remains the same task and projects the latest run after completion', async () => {
  const f = fixture();
  const { receipt } = await f.service.submit(f.profile, f.request);
  const first = f.tasks.getCurrent(receipt!.sessionId)!.task;
  f.tasks.beginRun({
    sessionId: first.sessionId,
    goal: first.goal,
    contract: first.contract,
    reservation: receipt!,
  });
  f.tasks.failRun(first.sessionId, { message: 'first attempt failed' }, receipt!.runId);
  const next = f.tasks.repository.createRun(first.id, WorkbenchRunTrigger.Retry);
  f.tasks.beginRun({
    sessionId: first.sessionId,
    goal: first.goal,
    contract: first.contract,
    reservation: { taskId: first.id, runId: next.id },
  });
  f.tasks.settleObservedRun({ sessionId: first.sessionId, runId: next.id, finalAnswer: 'done' });
  const [projection] = f.service.recent(f.profile.petId);
  expect(projection.receipt.taskId).toBe(first.id);
  expect(projection.status).toBe(WorkbenchExecutionStatus.Settled);
  expect(f.db.prepare('SELECT count(*) AS n FROM workbench_tasks').get()).toEqual({ n: 1 });
});

test('a companion receipt keeps its identity while the session follows current Workbench status', async () => {
  const f = fixture();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const first = await f.service.submit(f.profile, f.request);
  const receipt = first.receipt!;
  f.tasks.beginRun({
    sessionId: receipt.sessionId,
    goal: f.request.text,
    reservation: receipt,
  });
  f.tasks.settleObservedRun({ sessionId: receipt.sessionId, runId: receipt.runId });

  now.mockReturnValue(2000);
  f.tasks.beginRun({ sessionId: receipt.sessionId, goal: 'Follow-up' });
  expect(f.service.recent(f.profile.petId)).toEqual([
    expect.objectContaining({ receipt, status: WorkbenchExecutionStatus.Running, missing: false }),
  ]);
  const latest = f.tasks.beginRun({
    sessionId: receipt.sessionId,
    goal: 'Follow-up in the same millisecond',
  });
  expect(f.tasks.getCurrent(receipt.sessionId)?.task.id).toBe(latest.task.id);
  expect(f.service.recent(f.profile.petId)[0].status).toBe(WorkbenchExecutionStatus.Running);
  f.service.stop(f.profile.petId, receipt.sessionId);
  expect(f.stop).toHaveBeenCalledWith(receipt.sessionId);
  expect(await f.service.submit(f.profile, f.request)).toEqual(first);
  expect(f.start).toHaveBeenCalledOnce();
});

test('a native folder choice becomes visible without exposing filesystem paths in its result', async () => {
  const f = fixture();
  const directory = await realpath(await mkdtemp('/tmp/companion-folder-choice-'));
  try {
    const hidden = f.store.workspaces.ensureWorkspace(directory, 'Chosen project', true);
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

test('selected files reach the same native task and lost-reply retries survive file removal', async () => {
  const f = fixture();
  const directory = await mkdtemp('/tmp/companion-task-files-');
  const file = directory + '/selected-notes.md';
  try {
    await writeFile(file, 'Explicitly selected file.');
    const selected = await f.service.attachments.choose(f.profile.petId, [file]);
    const request = { ...f.request, attachmentIds: selected.map(item => item.id) };
    const result = await f.service.submit(f.profile, request);
    const session = f.store.getSession(result.receipt!.sessionId)!;
    const message = session.messages[0];
    expect(message.content).toBe(f.request.text);
    expect(session.systemPrompt).not.toContain('selected-notes.md');
    expect(message.metadata?.fileAttachments).toEqual([
      expect.objectContaining({ name: 'selected-notes.md', extension: 'MD' }),
    ]);
    expect(f.start).toHaveBeenCalledWith(
      result.receipt!.sessionId,
      expect.stringContaining(
        JSON.stringify({ name: 'selected-notes.md', path: await realpath(file) }),
      ),
      expect.objectContaining({
        fileAttachments: [expect.objectContaining({ name: 'selected-notes.md' })],
        modelOverride: 'available/model',
        systemPrompt: expect.stringContaining('Youli'),
      }),
    );
    await rm(file);
    expect(await f.service.submit(f.profile, request)).toEqual(result);
    await expect(f.service.submit(f.profile, { ...request, attachmentIds: [] })).rejects.toThrow(
      'different input',
    );
    await expect(f.service.submit(f.profile, { ...request, requestId: 'new' })).rejects.toThrow();
    expect(f.start).toHaveBeenCalledOnce();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('foreign or forged attachment grants cannot admit a task', async () => {
  const f = fixture();
  const directory = await mkdtemp('/tmp/companion-task-foreign-');
  try {
    const file = directory + '/private.txt';
    await writeFile(file, 'Private');
    const selected = await f.service.attachments.choose('another-pet', [file]);
    await expect(
      f.service.submit(f.profile, {
        ...f.request,
        attachmentIds: selected.map(item => item.id),
      }),
    ).rejects.toThrow('unavailable');
    expect(f.start).not.toHaveBeenCalled();
    expect(f.db.prepare('SELECT count(*) AS n FROM workbench_tasks').get()).toEqual({ n: 0 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
