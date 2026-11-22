import type Database from 'better-sqlite3';
import { runMigrations } from '../main/sqliteMigrations';
import { TaskStatus } from './constants';

export function initializeScheduledTaskSchema(db: Database.Database): void {
  db.exec(`
      CREATE TABLE IF NOT EXISTS zhiyuan_scheduled_tasks (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
        enabled INTEGER NOT NULL, schedule_json TEXT NOT NULL, session_target TEXT NOT NULL,
        wake_mode TEXT NOT NULL, payload_json TEXT NOT NULL, delivery_json TEXT NOT NULL,
        workspace_id TEXT, session_key TEXT, schedule_version TEXT NOT NULL,
        state_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS zhiyuan_scheduled_task_runs (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, schedule_version TEXT NOT NULL,
        scheduled_at TEXT, session_id TEXT, session_key TEXT, status TEXT NOT NULL,
        started_at TEXT NOT NULL, finished_at TEXT, duration_ms INTEGER, error TEXT,
        UNIQUE(task_id, schedule_version, scheduled_at)
      );
      CREATE INDEX IF NOT EXISTS idx_zhiyuan_scheduled_task_runs_task_started
        ON zhiyuan_scheduled_task_runs(task_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_zhiyuan_scheduled_task_runs_started
        ON zhiyuan_scheduled_task_runs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_zhiyuan_scheduled_task_runs_updated
        ON zhiyuan_scheduled_task_runs(MAX(started_at, COALESCE(finished_at, started_at)));
      CREATE INDEX IF NOT EXISTS idx_zhiyuan_scheduled_task_runs_task_finished
        ON zhiyuan_scheduled_task_runs(task_id, finished_at) WHERE finished_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_zhiyuan_scheduled_task_runs_task_running
        ON zhiyuan_scheduled_task_runs(task_id, started_at DESC)
        WHERE status = '${TaskStatus.Running}';
      CREATE TABLE IF NOT EXISTS zhiyuan_scheduled_task_deliveries (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, task_id TEXT NOT NULL,
        mode TEXT NOT NULL, channel TEXT, destination TEXT, account_id TEXT,
        status TEXT NOT NULL, attempted_at TEXT NOT NULL, delivered_at TEXT,
        receipt_id TEXT, error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_zhiyuan_scheduled_task_deliveries_run
        ON zhiyuan_scheduled_task_deliveries(run_id, attempted_at DESC);
    `);
  runMigrations(db, 'scheduled-task', [
    {
      version: 1,
      name: 'scheduled-run-activity-fields',
      up: database => {
        database.exec(`
          ALTER TABLE zhiyuan_scheduled_task_runs ADD COLUMN task_name TEXT;
          ALTER TABLE zhiyuan_scheduled_task_runs ADD COLUMN reply_preview TEXT;
        `);
      },
    },
  ]);
}
