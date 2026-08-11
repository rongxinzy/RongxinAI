import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import { migrateLegacyScheduledTasksToCanonical } from './migrate';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';

test('imports legacy tasks into SQLite canonical storage without OpenClaw and preserves past at tasks', async () => {
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
