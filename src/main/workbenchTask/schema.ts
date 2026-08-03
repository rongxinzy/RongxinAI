import type Database from 'better-sqlite3';

export function initializeWorkbenchTaskSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workbench_tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL,
      contract_json TEXT NOT NULL,
      active_run_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_workbench_tasks_session_updated
      ON workbench_tasks(session_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workbench_tasks_session_status
      ON workbench_tasks(session_id, status);

    CREATE TABLE IF NOT EXISTS workbench_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      started_at INTEGER,
      ended_at INTEGER,
      verification_result_json TEXT,
      failure_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES workbench_tasks(id),
      UNIQUE(task_id, attempt)
    );

    CREATE INDEX IF NOT EXISTS idx_workbench_runs_task_attempt
      ON workbench_runs(task_id, attempt DESC);
    CREATE INDEX IF NOT EXISTS idx_workbench_runs_status
      ON workbench_runs(status);

    CREATE TABLE IF NOT EXISTS workbench_run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES workbench_runs(id),
      UNIQUE(run_id, sequence)
    );

    CREATE INDEX IF NOT EXISTS idx_workbench_run_events_run_sequence
      ON workbench_run_events(run_id, sequence);

    CREATE TABLE IF NOT EXISTS workbench_artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      reference TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      provenance TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES workbench_tasks(id),
      FOREIGN KEY (run_id) REFERENCES workbench_runs(id),
      UNIQUE(run_id, reference, content_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_workbench_artifacts_task
      ON workbench_artifacts(task_id, created_at);

    CREATE TABLE IF NOT EXISTS workbench_approvals (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      decision TEXT NOT NULL,
      decision_source TEXT,
      effect_status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_json TEXT NOT NULL,
      result_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      decided_at INTEGER,
      FOREIGN KEY (task_id) REFERENCES workbench_tasks(id),
      FOREIGN KEY (run_id) REFERENCES workbench_runs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_workbench_approvals_run
      ON workbench_approvals(run_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_workbench_approvals_decision_effect
      ON workbench_approvals(decision, effect_status);
  `);
}
