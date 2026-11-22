/**
 * Workspace CRUD tests for CoworkStore.
 * Moved from src/main/coworkStore.test.ts (issue #1069); drives the public
 * CoworkStore facade so the split modules stay contract-compatible.
 */
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock' },
}));

import path from 'path';

import { createCoworkStoreHarness, type CoworkStoreTestHarness } from './coworkStore.testHarness';

let harness: CoworkStoreTestHarness;

beforeEach(() => {
  harness = createCoworkStoreHarness();
});

test('creates independent workspaces for the same directory', () => {
  const { store } = harness;
  const sharedPath = '/tmp/shared-workspace';
  const first = store.workspaces.createWorkspace(sharedPath, '1');
  const second = store.workspaces.createWorkspace(sharedPath, '2');
  const third = store.workspaces.createWorkspace(sharedPath, '3');

  expect([first.id, second.id, third.id]).toEqual([
    expect.any(String),
    expect.any(String),
    expect.any(String),
  ]);
  expect(new Set([first.id, second.id, third.id]).size).toBe(3);
  expect([first, second, third].map(workspace => workspace.name)).toEqual(['1', '2', '3']);
  expect([first, second, third].map(workspace => workspace.path)).toEqual([
    sharedPath,
    sharedPath,
    sharedPath,
  ]);

  const firstSession = store.createSession(
    'first session',
    sharedPath,
    '',
    'local',
    [],
    'main',
    '',
    'work',
    undefined,
    first.id,
  );
  const secondSession = store.createSession(
    'second session',
    sharedPath,
    '',
    'local',
    [],
    'main',
    '',
    'work',
    undefined,
    second.id,
  );

  expect(firstSession.workspaceId).toBe(first.id);
  expect(secondSession.workspaceId).toBe(second.id);
  expect(store.listSessions(10, 0, undefined, first.id).sessions).toHaveLength(1);
  expect(store.listSessions(10, 0, undefined, second.id).sessions).toHaveLength(1);
  expect(store.listSessions(10, 0, undefined, third.id).sessions).toHaveLength(0);
});

test('workspace order changes only when the workspace is explicitly touched', () => {
  const { store } = harness;
  const first = store.workspaces.ensureWorkspace('/tmp/workspace-a', 'Workspace A');
  const second = store.workspaces.ensureWorkspace('/tmp/workspace-b', 'Workspace B');
  harness.db.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(100, first.id);
  harness.db.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(200, second.id);

  store.workspaces.ensureWorkspace('/tmp/workspace-a', 'Renamed by selection');

  expect(store.workspaces.getWorkspace(first.id)).toMatchObject({
    name: 'Workspace A',
    updatedAt: 100,
  });

  vi.useFakeTimers();
  vi.setSystemTime(300);
  store.workspaces.touchWorkspace(first.id);
  vi.useRealTimers();

  expect(store.workspaces.listWorkspaces().map(workspace => workspace.id)).toEqual([
    first.id,
    second.id,
  ]);
});

test('relocateWorkspace preserves session ownership under the renamed directory', () => {
  const { store } = harness;
  const beforePath = path.join(process.cwd(), 'workspace-before');
  const afterPath = path.join(process.cwd(), 'workspace-after');
  const session = store.createSession('rename me', beforePath);
  const oldWorkspace = store.workspaces.getWorkspace(session.workspaceId)!;

  const renamedWorkspace = store.workspaces.relocateWorkspace(
    oldWorkspace.id,
    afterPath,
    'workspace-after',
    [],
  );

  expect(renamedWorkspace).toMatchObject({ name: 'workspace-after', path: afterPath });
  expect(renamedWorkspace!.id).not.toBe(oldWorkspace.id);
  expect(store.workspaces.getWorkspace(oldWorkspace.id)).toBeNull();
  expect(store.getSession(session.id)).toMatchObject({
    cwd: afterPath,
    workspaceId: renamedWorkspace!.id,
  });
  expect(store.listSessions(10, 0, undefined, oldWorkspace.id).sessions).toHaveLength(0);
  expect(store.listSessions(10, 0, undefined, renamedWorkspace!.id).sessions).toHaveLength(1);
});

test('listWorkspaces and getWorkspace include attached folders', () => {
  const { store } = harness;
  const workspace = store.workspaces.createWorkspace('/tmp/workspace-folders', 'folders');
  store.workspaces.setWorkspaceFolders(workspace.id, ['/tmp/a', '/tmp/b']);

  expect(store.workspaces.getWorkspace(workspace.id)!.folders).toEqual(['/tmp/a', '/tmp/b']);
  expect(store.workspaces.listWorkspaces().find(item => item.id === workspace.id)!.folders).toEqual(
    ['/tmp/a', '/tmp/b'],
  );
});

test('deleteWorkspace removes attached folders', () => {
  const { store } = harness;
  const workspace = store.workspaces.createWorkspace('/tmp/workspace-delete-folders', 'delete-me');
  store.workspaces.setWorkspaceFolders(workspace.id, ['/tmp/a']);

  store.workspaces.deleteWorkspace(workspace.id);

  expect(store.workspaces.getWorkspace(workspace.id)).toBeNull();
  expect(
    harness.db
      .prepare('SELECT COUNT(*) AS count FROM workspace_folders WHERE workspace_id = ?')
      .get(workspace.id),
  ).toEqual({ count: 0 });
});

test('relocateWorkspace transfers folders and migrates project memory scope', () => {
  const { db, store } = harness;
  db.exec(`
    CREATE TABLE memory_links (id TEXT PRIMARY KEY, project_id TEXT NOT NULL);
    CREATE TABLE memory_candidates (id TEXT PRIMARY KEY, project_id TEXT NOT NULL DEFAULT '');
  `);
  const beforePath = path.join(process.cwd(), 'workspace-memory-before');
  const afterPath = path.join(process.cwd(), 'workspace-memory-after');
  const session = store.createSession('memory session', beforePath);
  const oldWorkspace = store.workspaces.getWorkspace(session.workspaceId)!;
  store.workspaces.setWorkspaceFolders(oldWorkspace.id, ['/tmp/extra']);
  db.prepare('INSERT INTO memory_links (id, project_id) VALUES (?, ?)').run(
    'link-1',
    oldWorkspace.id,
  );
  db.prepare('INSERT INTO memory_candidates (id, project_id) VALUES (?, ?)').run(
    'candidate-1',
    oldWorkspace.id,
  );

  const relocated = store.workspaces.relocateWorkspace(
    oldWorkspace.id,
    afterPath,
    'workspace-memory-after',
    [],
  );

  expect(relocated).not.toBeNull();
  expect(store.workspaces.getWorkspace(relocated!.id)!.folders).toEqual(['/tmp/extra']);
  expect(db.prepare('SELECT project_id FROM memory_links WHERE id = ?').get('link-1')).toEqual({
    project_id: relocated!.id,
  });
  expect(
    db.prepare('SELECT project_id FROM memory_candidates WHERE id = ?').get('candidate-1'),
  ).toEqual({ project_id: relocated!.id });
});

test('relocateWorkspace guards live sessions and leaves stored status alone', () => {
  const { db, store } = harness;
  const session = store.createSession('running session', path.join(process.cwd(), 'workspace-run'));
  const workspace = store.workspaces.getWorkspace(session.workspaceId)!;
  const nextPath = path.join(process.cwd(), 'workspace-run-2');
  const other = store.createSession('Other workspace', path.join(process.cwd(), 'another'));

  expect(() =>
    store.workspaces.relocateWorkspace(workspace.id, nextPath, 'run-2', [session.id]),
  ).toThrow('running');

  expect(store.workspaces.getWorkspace(workspace.id)!.path).toBe(workspace.path);
  db.prepare("UPDATE cowork_sessions SET status = 'running' WHERE id = ?").run(session.id);
  expect(
    store.workspaces.relocateWorkspace(workspace.id, nextPath, 'run-2', [other.id]),
  ).not.toBeNull();
  expect(store.getSession(session.id)).toMatchObject({ cwd: nextPath, status: 'idle' });
  expect(db.prepare('SELECT status FROM cowork_sessions WHERE id = ?').get(session.id)).toEqual({
    status: 'running',
  });
});

test('renameWorkspace updates the name and returns null for unknown ids', () => {
  const { store } = harness;
  const workspace = store.workspaces.ensureWorkspace('/tmp/workspace-rename');

  expect(store.workspaces.renameWorkspace(workspace.id, 'Renamed')).toMatchObject({
    name: 'Renamed',
  });
  expect(store.workspaces.renameWorkspace('workspace-missing', 'Nope')).toBeNull();
});

test('setWorkspaceHidden toggles the hidden flag', () => {
  const { store } = harness;
  const workspace = store.workspaces.ensureWorkspace('/tmp/workspace-hidden');

  expect(store.workspaces.getWorkspace(workspace.id)!.isHidden).toBe(false);

  store.workspaces.setWorkspaceHidden(workspace.id, true);
  expect(store.workspaces.getWorkspace(workspace.id)!.isHidden).toBe(true);

  store.workspaces.setWorkspaceHidden(workspace.id, false);
  expect(store.workspaces.getWorkspace(workspace.id)!.isHidden).toBe(false);
});

test('ensureWorkspace is idempotent per path, keeps the first name and hides stickily', () => {
  const { store } = harness;
  const first = store.workspaces.ensureWorkspace('/tmp/workspace-idempotent', 'First');
  const again = store.workspaces.ensureWorkspace('/tmp/workspace-idempotent', 'Second');

  expect(again.id).toBe(first.id);
  expect(again.name).toBe('First');

  const hidden = store.workspaces.ensureWorkspace('/tmp/workspace-sticky-hidden', 'Hidden', true);
  expect(store.workspaces.getWorkspace(hidden.id)!.isHidden).toBe(true);

  const reEnsured = store.workspaces.ensureWorkspace(
    '/tmp/workspace-sticky-hidden',
    'Hidden',
    false,
  );
  expect(reEnsured.id).toBe(hidden.id);
  expect(store.workspaces.getWorkspace(hidden.id)!.isHidden).toBe(true);
});
