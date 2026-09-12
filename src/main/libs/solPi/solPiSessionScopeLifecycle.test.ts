/**
 * Lifecycle tests for the app-owned SoL-Pi session storage: async cleanup and
 * startup reconciliation of orphaned archive directories, plus the
 * CoworkStore.listSessionIds feed reconciliation relies on.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock' },
}));

import BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CoworkStore } from '../../coworkStore';
import {
  clearSolPiSessionStorage,
  reconcileSolPiSessionStorage,
  solPiSessionStorageDir,
  solPiStorageRoot,
} from './solPiSessionScope';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('clearSolPiSessionStorage (async)', () => {
  test('removes the session archive tree and resolves for nonexistent dirs', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'solpi-scope-clear-'));
    const sessionDir = solPiSessionStorageDir(root, 'session-a');
    mkdirSync(path.join(sessionDir, 'sol-pi', 'observation-pack', 'objects'), { recursive: true });
    writeFileSync(path.join(sessionDir, 'sol-pi', 'observation-pack', 'objects', 'obs_x.txt'), 'x');

    await expect(clearSolPiSessionStorage(root, 'session-a')).resolves.toBeUndefined();
    expect(existsSync(sessionDir)).toBe(false);
    expect(existsSync(root)).toBe(true);

    // Nonexistent dir: force:true semantics, still resolves without throwing.
    await expect(clearSolPiSessionStorage(root, 'session-gone')).resolves.toBeUndefined();
  });
});

describe('reconcileSolPiSessionStorage', () => {
  let userData: string;
  let storageRoot: string;

  const makeSessionDir = (name: string): string => {
    const dir = path.join(storageRoot, name);
    mkdirSync(path.join(dir, 'sol-pi', 'observation-pack', 'objects'), { recursive: true });
    return dir;
  };

  const ageDir = (dir: string, ageMs: number): void => {
    const when = new Date(Date.now() - ageMs);
    utimesSync(dir, when, when);
  };

  beforeEach(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'solpi-scope-rec-'));
    storageRoot = solPiStorageRoot(userData);
    mkdirSync(storageRoot, { recursive: true });
  });

  test('removes only orphaned dirs older than 24 hours; keeps live and fresh ones', async () => {
    const liveDir = makeSessionDir('live-session');
    ageDir(liveDir, 3 * DAY_MS); // live beats age
    const freshOrphan = makeSessionDir('fresh-orphan');
    ageDir(freshOrphan, 0);
    const oldOrphan = makeSessionDir('old-orphan');
    ageDir(oldOrphan, 2 * DAY_MS);

    const removed = await reconcileSolPiSessionStorage(userData, ['live-session']);

    expect(removed).toEqual(['old-orphan']);
    expect(existsSync(liveDir)).toBe(true);
    expect(existsSync(freshOrphan)).toBe(true);
    expect(existsSync(oldOrphan)).toBe(false);
  });

  test('ignores weird entries (files, unsafe names) and never throws; empty for missing root', async () => {
    writeFileSync(path.join(storageRoot, 'stray-file.txt'), 'not a session');
    // A real child directory whose NAME fails the safe session-id shape
    // (leading dot) must be left alone even when old.
    const unsafeDir = makeSessionDir('..escape-attempt');
    ageDir(unsafeDir, 3 * DAY_MS);

    const removed = await reconcileSolPiSessionStorage(userData, []);
    expect(removed).toEqual([]);
    expect(existsSync(path.join(storageRoot, 'stray-file.txt'))).toBe(true);
    expect(existsSync(unsafeDir)).toBe(true);

    const missingRoot = await reconcileSolPiSessionStorage(
      path.join(userData, 'no-such-user-data'),
      [],
    );
    expect(missingRoot).toEqual([]);
  });

  test('cleans up leftovers that survived an aborted run', async () => {
    // A directory left behind by a crash: old, not in the live set.
    const orphan = makeSessionDir('crash-orphan');
    ageDir(orphan, 5 * DAY_MS);
    const removed = await reconcileSolPiSessionStorage(userData, []);
    expect(removed).toEqual(['crash-orphan']);
    expect(existsSync(orphan)).toBe(false);
  });
});

/**
 * better-sqlite3 in this worktree is compiled for the Electron ABI
 * (npm run rebuild:electron-native); under a plain-Node vitest run the native
 * module cannot load. Those environments skip these two tests — the same
 * environment failure already affects src/main/coworkStore.test.ts.
 */
const nativeSqliteLoads = (() => {
  try {
    new BetterSqlite3(':memory:').close();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!nativeSqliteLoads)('CoworkStore.listSessionIds', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    db.exec(`
      CREATE TABLE cowork_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        title_user_renamed INTEGER NOT NULL DEFAULT 0,
        claude_session_id TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        mode TEXT NOT NULL DEFAULT 'work',
        pinned INTEGER NOT NULL DEFAULT 0,
        pin_order INTEGER,
        cwd TEXT NOT NULL,
        system_prompt TEXT NOT NULL DEFAULT '',
        model_override TEXT NOT NULL DEFAULT '',
        execution_mode TEXT NOT NULL DEFAULT 'local',
        active_skill_ids TEXT,
        workspace_id TEXT,
        agent_id TEXT NOT NULL DEFAULT 'main',
        source TEXT NOT NULL DEFAULT 'manual',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  });

  test('returns every persisted session id', () => {
    const insert = db.prepare(
      "INSERT INTO cowork_sessions (id, title, cwd, workspace_id, created_at, updated_at) VALUES (?, 't', '/tmp', 'w1', 0, 0)",
    );
    insert.run('session-a');
    insert.run('session-b');
    insert.run('scheduled-task:task-1');

    const store = new CoworkStore(db);
    expect(store.listSessionIds().sort()).toEqual([
      'scheduled-task:task-1',
      'session-a',
      'session-b',
    ]);
  });

  test('returns an empty list for an empty store', () => {
    const store = new CoworkStore(db);
    expect(store.listSessionIds()).toEqual([]);
  });
});
