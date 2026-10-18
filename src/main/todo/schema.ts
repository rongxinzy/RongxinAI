/**
 * Todo schema: current-shape DDL plus the versioned migration list.
 *
 * The DDL creates the full current tables on a fresh database. Migration 1 is
 * the legacy reconcile for the column adds and indexes that used to be
 * re-probed on every startup. Fresh databases no-op through it and record the
 * version.
 */
import type Database from 'better-sqlite3';

import { addColumnIfMissing, runMigrations, type Migration } from '../sqliteMigrations';

export const TODO_SCHEMA_SCOPE = 'todo';

function reconcileLegacyTodoSchema(db: Database.Database): void {
  addColumnIfMissing(db, 'todos', 'remind_notified_at', 'INTEGER');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_todos_reminders ON todos(status, remind_at, remind_notified_at)',
  );
}

export function todoMigrations(): Migration[] {
  return [
    {
      version: 1,
      name: 'legacy-reconcile',
      up: reconcileLegacyTodoSchema,
    },
  ];
}

export function initializeTodoSchema(db: Database.Database): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS todo_lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      important INTEGER NOT NULL DEFAULT 0,
      due_at INTEGER,
      remind_at INTEGER,
      remind_notified_at INTEGER,
      list_id TEXT,
      my_day_date TEXT,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (list_id) REFERENCES todo_lists(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_todos_status_updated_at
      ON todos(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_todos_my_day_date
      ON todos(my_day_date, status);
    CREATE INDEX IF NOT EXISTS idx_todos_due_at
      ON todos(due_at, status);

    CREATE TABLE IF NOT EXISTS todo_steps (
      id TEXT PRIMARY KEY,
      todo_id TEXT NOT NULL,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      step_order INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_todo_steps_todo_order
      ON todo_steps(todo_id, step_order ASC, created_at ASC);
  `);
  runMigrations(db, TODO_SCHEMA_SCOPE, todoMigrations());
}
