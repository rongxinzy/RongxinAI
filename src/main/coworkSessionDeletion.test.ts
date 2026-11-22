import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { lifecycleRuntime } from './appBootstrap/lifecycleRuntimeState';
import { createCoworkSessionDeletion } from './coworkSessionDeletion';
import { createCoworkStoreHarness } from './coworkStore/coworkStore.testHarness';
import { IMStore } from './im/imStore';
import { initializeIMSchema } from './im/schema';
import { resolveProjectIdentity } from './memory/projectIdentity';
import { ProjectMemoryService } from './memory/projectMemoryService';
import { MemoryRepository } from './memory/repository';
import { WorkbenchTaskService } from './workbenchTask/taskService';
import { initializeWorkbenchTaskSchema } from './workbenchTask/schema';
import { WorkbenchRunTrigger } from '../shared/workbenchTask';

let harness: ReturnType<typeof createCoworkStoreHarness>;
let im: IMStore;
let memory: MemoryRepository;
let workbench: WorkbenchTaskService;
let deleteSessions: ReturnType<typeof createCoworkSessionDeletion>;
const forgetSession = vi.fn();

beforeEach(() => {
  harness = createCoworkStoreHarness();
  initializeIMSchema(harness.db);
  initializeWorkbenchTaskSchema(harness.db);
  workbench = new WorkbenchTaskService(harness.db);
  im = new IMStore(harness.db);
  memory = new MemoryRepository(harness.db);
  const service = new ProjectMemoryService(memory, {} as never, resolveProjectIdentity, '/memory');
  forgetSession.mockReset();
  deleteSessions = createCoworkSessionDeletion({
    getCoworkStore: () => harness.store,
    getProjectMemoryService: () => service,
    getIMStore: () => im,
    getWorkbenchTaskService: () => workbench,
    forgetSession,
  });
});

afterEach(() => harness.db.close());

function arrangeWorkspace() {
  const { store } = harness;
  const workspace = store.workspaces.createWorkspace('/tmp/remove-workspace', 'Remove');
  store.workspaces.setWorkspaceFolders(workspace.id, ['/tmp/additional']);
  const first = store.createSession(
    'First',
    workspace.path,
    '',
    'local',
    [],
    'main',
    '',
    'work',
    undefined,
    workspace.id,
  );
  const second = store.createSession(
    'Second',
    workspace.path,
    '',
    'local',
    [],
    'main',
    '',
    'work',
    undefined,
    workspace.id,
  );
  const kept = store.createSession('Kept', '/tmp/other-workspace');
  store.messages.addMessage(first.id, { type: 'assistant', content: 'Remember this result' });
  store.messages.addMessage(kept.id, { type: 'user', content: 'Keep this message' });
  im.createSessionMapping('remove', 'feishu', first.id);
  im.createSessionMapping('keep', 'feishu', kept.id);
  return { workspace, first, second, kept };
}

test('workspace deletion records each owned session and removes its mappings before cleanup', async () => {
  const { db, store } = harness;
  const { workspace, first, second, kept } = arrangeWorkspace();
  const earlier = workbench.beginRun({ sessionId: first.id, goal: 'Remove earlier work' });
  const retry = workbench.repository.createRun(earlier.task.id, WorkbenchRunTrigger.Retry);
  const { task } = workbench.beginRun({ sessionId: first.id, goal: 'Remove this run' });
  const additional = workbench.beginRun({ sessionId: second.id, goal: 'Remove second session' });
  const retained = workbench.beginRun({ sessionId: kept.id, goal: 'Keep this run' }).task;
  const changed = vi.fn(() => {
    expect(db.inTransaction).toBe(false);
    expect(workbench.getDetail(task.id)).toBeNull();
  });
  workbench.on('changed', changed);
  forgetSession.mockImplementation((id: string) => {
    expect(db.inTransaction).toBe(false);
    expect(store.getSession(id)).toBeNull();
    expect(im.getSessionMappingByCoworkSessionId(id)).toBeNull();
    expect(workbench.listForSession(id)).toEqual([]);
    expect(memory.listPending().some(item => item.payload.sessionId === id)).toBe(true);
  });

  const removed = await deleteSessions({ workspaceId: workspace.id }, () =>
    store.workspaces.deleteWorkspace(workspace.id),
  );

  expect(removed?.sort()).toEqual([first.id, second.id].sort());
  expect(store.workspaces.getWorkspace(workspace.id)).toBeNull();
  expect(
    db.prepare('SELECT path FROM workspace_folders WHERE workspace_id = ?').all(workspace.id),
  ).toEqual([]);
  expect(store.messages.countSessionMessages(first.id)).toBe(0);
  expect(store.messages.countSessionMessages(kept.id)).toBe(1);
  expect(im.getSessionMappingByCoworkSessionId(kept.id)).not.toBeNull();
  expect(workbench.getDetail(task.id)).toBeNull();
  expect(workbench.getDetail(earlier.task.id)).toBeNull();
  expect(workbench.repository.getRun(retry.id)).toBeNull();
  expect(workbench.getDetail(additional.task.id)).toBeNull();
  expect(workbench.getDetail(retained.id)).not.toBeNull();
  expect(changed).toHaveBeenCalledTimes(2);
  expect(changed).toHaveBeenCalledWith({ sessionId: first.id, taskId: task.id });
  expect(changed).toHaveBeenCalledWith({ sessionId: second.id, taskId: additional.task.id });
  expect(forgetSession).toHaveBeenCalledTimes(2);
  expect(
    (
      db
        .prepare('SELECT summary FROM memory_session_finalizations WHERE local_session_id = ?')
        .get(first.id) as { summary: string }
    ).summary,
  ).toContain('Remember this result');
});

test.each([
  ['workspace_folders', 'DELETE'],
  ['channel_session_mappings', 'DELETE'],
  ['workbench_run_events', 'DELETE'],
  ['memory_outbox', 'INSERT'],
])('restores the workspace graph when %s rejects the transaction', async (table, operation) => {
  const { db, store } = harness;
  const { workspace, first, second } = arrangeWorkspace();
  const { task, run } = workbench.beginRun({ sessionId: first.id, goal: 'Preserve this run' });
  workbench.settleObservedRun({ sessionId: first.id, runId: run.id });
  const changed = vi.fn();
  workbench.on('changed', changed);
  db.exec(`CREATE TRIGGER reject_delete BEFORE ${operation} ON ${table}
    BEGIN SELECT RAISE(ABORT, 'rejected by fixture'); END;`);

  await expect(
    deleteSessions({ workspaceId: workspace.id }, () =>
      store.workspaces.deleteWorkspace(workspace.id),
    ),
  ).rejects.toThrow('rejected by fixture');

  expect(store.workspaces.getWorkspace(workspace.id)?.folders).toEqual(['/tmp/additional']);
  expect(store.getSession(first.id)).not.toBeNull();
  expect(store.getSession(second.id)).not.toBeNull();
  expect(store.messages.countSessionMessages(first.id)).toBe(1);
  expect(im.getSessionMappingByCoworkSessionId(first.id)).not.toBeNull();
  expect(workbench.getDetail(task.id)).not.toBeNull();
  expect(changed).not.toHaveBeenCalled();
  expect(memory.listPending()).toEqual([]);
  expect(forgetSession).not.toHaveBeenCalled();
});

test('explicit deletion ignores missing and repeated IDs and reports exact removals', async () => {
  const { store } = harness;
  const session = store.createSession('Remove', '/tmp/remove-explicit');
  const historyKey = store.getPiHistoryKey(session.id);

  await expect(deleteSessions({ ids: ['missing', session.id, session.id] })).resolves.toEqual([
    session.id,
  ]);
  await expect(deleteSessions({ ids: [session.id] })).resolves.toEqual([]);
  expect(forgetSession).toHaveBeenCalledExactlyOnceWith(session.id, historyKey);
  expect(memory.listPending()).toMatchObject([{ payload: { sessionId: session.id } }]);
});

test('quit closes deletion admission before changing SQLite', async () => {
  const { store } = harness;
  const session = store.createSession('Keep', '/tmp/quit-before-deletion');
  lifecycleRuntime.isQuitting = true;
  try {
    await expect(deleteSessions({ ids: [session.id] })).rejects.toThrow(
      'The application is shutting down.',
    );
    expect(store.getSession(session.id)).not.toBeNull();
    expect(forgetSession).not.toHaveBeenCalled();
  } finally {
    lifecycleRuntime.isQuitting = false;
  }
});

test('a silently skipped session prevents partial cleanup of its owner', async () => {
  const { db, store } = harness;
  const { workspace, first } = arrangeWorkspace();
  db.exec(
    `CREATE TRIGGER skip_delete BEFORE DELETE ON cowork_sessions BEGIN SELECT RAISE(IGNORE); END;`,
  );

  await expect(
    deleteSessions({ workspaceId: workspace.id }, () =>
      store.workspaces.deleteWorkspace(workspace.id),
    ),
  ).rejects.toThrow('Could not delete every selected Cowork session');
  expect(store.workspaces.getWorkspace(workspace.id)).not.toBeNull();
  expect(store.getSession(first.id)).not.toBeNull();
  expect(memory.listPending()).toEqual([]);
  expect(forgetSession).not.toHaveBeenCalled();
});
