import type Database from 'better-sqlite3';

import type { ProductionLoopState } from '../../shared/productionLoop';

type ProductionLoopRow = {
  state_json: string;
};

export class ProductionLoopRepository {
  constructor(private readonly db: Database.Database) {}

  transaction<T>(operation: () => T): T {
    return this.db.transaction(operation)();
  }

  create(state: ProductionLoopState): ProductionLoopState {
    this.db
      .prepare(
        `INSERT INTO workbench_production_loops
         (run_id, task_id, workflow_kind, state_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        state.runId,
        state.taskId,
        state.workflowKind,
        JSON.stringify(state),
        state.createdAt,
        state.updatedAt,
      );
    return state;
  }

  get(runId: string): ProductionLoopState | null {
    const row = this.db
      .prepare('SELECT state_json FROM workbench_production_loops WHERE run_id = ?')
      .get(runId) as ProductionLoopRow | undefined;
    if (!row) return null;
    return JSON.parse(row.state_json) as ProductionLoopState;
  }

  getLatestForTask(taskId: string, excludeRunId?: string): ProductionLoopState | null {
    const row = this.db
      .prepare(
        `SELECT state_json FROM workbench_production_loops
         WHERE task_id = ? AND run_id <> ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(taskId, excludeRunId || '') as ProductionLoopRow | undefined;
    return row ? (JSON.parse(row.state_json) as ProductionLoopState) : null;
  }

  update(state: ProductionLoopState): ProductionLoopState {
    const updatedAt = Date.now();
    const next = { ...state, updatedAt };
    const result = this.db
      .prepare(
        `UPDATE workbench_production_loops
         SET state_json = ?, workflow_kind = ?, updated_at = ?
         WHERE run_id = ?`,
      )
      .run(JSON.stringify(next), next.workflowKind, updatedAt, next.runId);
    if (result.changes !== 1) throw new Error(`Production loop not found: ${state.runId}`);
    return next;
  }

  deleteForSession(sessionId: string): void {
    this.db
      .prepare(
        `DELETE FROM workbench_production_loops
         WHERE task_id IN (SELECT id FROM workbench_tasks WHERE session_id = ?)`,
      )
      .run(sessionId);
  }
}
