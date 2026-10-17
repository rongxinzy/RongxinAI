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
  const first = store.createWorkspace(sharedPath, '1');
  const second = store.createWorkspace(sharedPath, '2');
  const third = store.createWorkspace(sharedPath, '3');

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
  expect(store.countSessions(undefined, first.id)).toBe(1);
  expect(store.countSessions(undefined, second.id)).toBe(1);
  expect(store.countSessions(undefined, third.id)).toBe(0);
});

test('workspace order changes only when the workspace is explicitly touched', () => {
  const { store } = harness;
  const first = store.ensureWorkspace('/tmp/workspace-a', 'Workspace A');
  const second = store.ensureWorkspace('/tmp/workspace-b', 'Workspace B');
  harness.db.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(100, first.id);
  harness.db.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(200, second.id);

  store.ensureWorkspace('/tmp/workspace-a', 'Renamed by selection');

  expect(store.getWorkspace(first.id)).toMatchObject({
    name: 'Workspace A',
    updatedAt: 100,
  });

  vi.useFakeTimers();
  vi.setSystemTime(300);
  store.touchWorkspace(first.id);
  vi.useRealTimers();

  expect(store.listWorkspaces().map(workspace => workspace.id)).toEqual([first.id, second.id]);
});

test('relocateWorkspace preserves session ownership under the renamed directory', () => {
  const { store } = harness;
  const beforePath = path.join(process.cwd(), 'workspace-before');
  const afterPath = path.join(process.cwd(), 'workspace-after');
  const session = store.createSession('rename me', beforePath);
  const oldWorkspace = store.getWorkspace(session.workspaceId)!;

  const renamedWorkspace = store.relocateWorkspace(oldWorkspace.id, afterPath, 'workspace-after');

  expect(renamedWorkspace).toMatchObject({ name: 'workspace-after', path: afterPath });
  expect(renamedWorkspace!.id).not.toBe(oldWorkspace.id);
  expect(store.getWorkspace(oldWorkspace.id)).toBeNull();
  expect(store.getSession(session.id)).toMatchObject({
    cwd: afterPath,
    workspaceId: renamedWorkspace!.id,
  });
  expect(store.countSessions(undefined, oldWorkspace.id)).toBe(0);
  expect(store.countSessions(undefined, renamedWorkspace!.id)).toBe(1);
});

test('listWorkspaces and getWorkspace include attached folders', () => {
  const { store } = harness;
  const workspace = store.createWorkspace('/tmp/workspace-folders', 'folders');
  store.setWorkspaceFolders(workspace.id, ['/tmp/a', '/tmp/b']);

  expect(store.getWorkspace(workspace.id)!.folders).toEqual(['/tmp/a', '/tmp/b']);
  expect(store.listWorkspaces().find(item => item.id === workspace.id)!.folders).toEqual([
    '/tmp/a',
    '/tmp/b',
  ]);
});

test('deleteWorkspace removes attached folders', () => {
  const { store } = harness;
  const workspace = store.createWorkspace('/tmp/workspace-delete-folders', 'delete-me');
  store.setWorkspaceFolders(workspace.id, ['/tmp/a']);

  store.deleteWorkspace(workspace.id);

  expect(store.getWorkspace(workspace.id)).toBeNull();
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
  const oldWorkspace = store.getWorkspace(session.workspaceId)!;
  store.setWorkspaceFolders(oldWorkspace.id, ['/tmp/extra']);
  db.prepare('INSERT INTO memory_links (id, project_id) VALUES (?, ?)').run(
    'link-1',
    oldWorkspace.id,
  );
  db.prepare('INSERT INTO memory_candidates (id, project_id) VALUES (?, ?)').run(
    'candidate-1',
    oldWorkspace.id,
  );

  const relocated = store.relocateWorkspace(oldWorkspace.id, afterPath, 'workspace-memory-after');

  expect(relocated).not.toBeNull();
  expect(store.getWorkspace(relocated!.id)!.folders).toEqual(['/tmp/extra']);
  expect(db.prepare('SELECT project_id FROM memory_links WHERE id = ?').get('link-1')).toEqual({
    project_id: relocated!.id,
  });
  expect(
    db.prepare('SELECT project_id FROM memory_candidates WHERE id = ?').get('candidate-1'),
  ).toEqual({ project_id: relocated!.id });
});

test('relocateWorkspace rejects while a session is running', () => {
  const { db, store } = harness;
  const session = store.createSession('running session', path.join(process.cwd(), 'workspace-run'));
  const workspace = store.getWorkspace(session.workspaceId)!;
  db.prepare("UPDATE cowork_sessions SET status = 'running' WHERE id = ?").run(session.id);

  expect(() =>
    store.relocateWorkspace(workspace.id, path.join(process.cwd(), 'workspace-run-2'), 'run-2'),
  ).toThrow('running');

  expect(store.getWorkspace(workspace.id)!.path).toBe(workspace.path);
});

test('deleteWorkspace returns the ids of the sessions it removed', () => {
  const { store } = harness;
  const workspace = store.createWorkspace('/tmp/workspace-delete-sessions', 'delete-sessions');
  const first = store.createSession(
    'first',
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
    'second',
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
  const kept = store.createSession('kept', '/tmp/workspace-kept');

  expect(store.deleteWorkspace(workspace.id).sort()).toEqual([first.id, second.id].sort());
  expect(store.getSession(first.id)).toBeNull();
  expect(store.getSession(second.id)).toBeNull();
  expect(store.getSession(kept.id)).not.toBeNull();
});

test('renameWorkspace updates the name and returns null for unknown ids', () => {
  const { store } = harness;
  const workspace = store.ensureWorkspace('/tmp/workspace-rename');

  expect(store.renameWorkspace(workspace.id, 'Renamed')).toMatchObject({ name: 'Renamed' });
  expect(store.renameWorkspace('workspace-missing', 'Nope')).toBeNull();
});

test('setWorkspaceHidden toggles the hidden flag', () => {
  const { store } = harness;
  const workspace = store.ensureWorkspace('/tmp/workspace-hidden');

  expect(store.getWorkspace(workspace.id)!.isHidden).toBe(false);

  store.setWorkspaceHidden(workspace.id, true);
  expect(store.getWorkspace(workspace.id)!.isHidden).toBe(true);

  store.setWorkspaceHidden(workspace.id, false);
  expect(store.getWorkspace(workspace.id)!.isHidden).toBe(false);
});

test('ensureWorkspace is idempotent per path, keeps the first name and hides stickily', () => {
  const { store } = harness;
  const first = store.ensureWorkspace('/tmp/workspace-idempotent', 'First');
  const again = store.ensureWorkspace('/tmp/workspace-idempotent', 'Second');

  expect(again.id).toBe(first.id);
  expect(again.name).toBe('First');

  const hidden = store.ensureWorkspace('/tmp/workspace-sticky-hidden', 'Hidden', true);
  expect(store.getWorkspace(hidden.id)!.isHidden).toBe(true);

  const reEnsured = store.ensureWorkspace('/tmp/workspace-sticky-hidden', 'Hidden', false);
  expect(reEnsured.id).toBe(hidden.id);
  expect(store.getWorkspace(hidden.id)!.isHidden).toBe(true);
});
