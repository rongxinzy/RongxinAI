import type Database from 'better-sqlite3';

export function initializeProductionLoopSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workbench_production_loops (
      run_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      workflow_kind TEXT NOT NULL,
      state_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES workbench_tasks(id),
      FOREIGN KEY (run_id) REFERENCES workbench_runs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_workbench_production_loops_task
      ON workbench_production_loops(task_id, updated_at DESC);
  `);
}
