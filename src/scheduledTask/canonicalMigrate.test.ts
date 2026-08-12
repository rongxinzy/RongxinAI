import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import { migrateLegacyScheduledTaskRunsToCanonical, migrateLegacyScheduledTasksToCanonical } from './migrate';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';

test('imports legacy tasks into canonical SQLite and preserves past at tasks', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE scheduled_tasks (id TEXT, name TEXT, description TEXT, enabled INTEGER, schedule_json TEXT, prompt TEXT, notify_platforms_json TEXT)`);
  db.prepare('INSERT INTO scheduled_tasks VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'legacy-at', 'Old reminder', '', 1, JSON.stringify({ type: 'at', datetime: '2020-01-01T09:00:00+08:00' }), 'remember', '[]',
  );
  const values = new Map<string, string>();
  const store = new SqliteScheduledTaskStore(db);
  await migrateLegacyScheduledTasksToCanonical({ db, store, getKv: key => values.get(key), setKv: (key, value) => values.set(key, value) });
  expect(store.get('legacy-at')).toMatchObject({ id: 'legacy-at', name: 'Old reminder', schedule: { kind: 'at' } });
  expect(values.get('scheduled_tasks_migrated_to_canonical_v1')).toBe('true');
});

test('imports legacy Run history into canonical SQLite', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE scheduled_task_runs (id TEXT, task_id TEXT, session_id TEXT, status TEXT, started_at TEXT, finished_at TEXT, duration_ms INTEGER, error TEXT)`);
  db.prepare('INSERT INTO scheduled_task_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('run-1', 'task-1', 'session', 'success', '2026-08-11T01:00:00.000Z', '2026-08-11T01:00:01.000Z', 1000, null);
  const values = new Map<string, string>();
  const store = new SqliteScheduledTaskStore(db);
  await migrateLegacyScheduledTaskRunsToCanonical({ db, store, getKv: key => values.get(key), setKv: (key, value) => values.set(key, value) });
  expect(store.listRuns('task-1')).toMatchObject([{ id: 'run-1', status: 'success', sessionId: 'session' }]);
  expect(values.get('scheduled_task_runs_migrated_to_canonical_v1')).toBe('true');
});

test('rolls back the canonical import and completion marker when any ZhiYuan task is invalid', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE scheduled_tasks (id TEXT, name TEXT, description TEXT, enabled INTEGER, schedule_json TEXT, prompt TEXT, notify_platforms_json TEXT)`);
  const insert = db.prepare('INSERT INTO scheduled_tasks VALUES (?, ?, ?, ?, ?, ?, ?)');
  insert.run('valid', 'Valid', '', 1, JSON.stringify({ type: 'interval', intervalMs: 60_000 }), 'run', '[]');
  insert.run('invalid', 'Invalid', '', 1, '{broken', 'run', '[]');
  const values = new Map<string, string>();
  const store = new SqliteScheduledTaskStore(db);
  await expect(migrateLegacyScheduledTasksToCanonical({
    db, store, getKv: key => values.get(key), setKv: (key, value) => values.set(key, value),
  })).rejects.toThrow('invalid');
  expect(store.list()).toEqual([]);
  expect(values.has('scheduled_tasks_migrated_to_canonical_v1')).toBe(false);
});
