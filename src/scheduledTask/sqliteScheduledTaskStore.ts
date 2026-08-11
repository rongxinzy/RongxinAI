import { createHash, randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import { DeliveryMode, TaskStatus } from './constants';
import type {
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRun,
  ScheduledTaskRunWithName,
  TaskState,
} from './types';

type TaskRow = {
  id: string; name: string; description: string; enabled: number; schedule_json: string;
  session_target: string; wake_mode: string; payload_json: string; delivery_json: string;
  agent_id: string; session_key: string | null; schedule_version: string;
  state_json: string; created_at: string; updated_at: string;
};
type RunRow = {
  id: string; task_id: string; schedule_version: string; scheduled_at: string | null;
  session_id: string | null; session_key: string | null; status: string; started_at: string;
  finished_at: string | null; duration_ms: number | null; error: string | null;
};

const initialState = (): TaskState => ({
  nextRunAtMs: null, lastRunAtMs: null, lastStatus: null, lastError: null,
  lastDurationMs: null, runningAtMs: null, consecutiveErrors: 0,
});

/**
 * Canonical durable scheduler state. cc-connect is deliberately not referenced
 * here: it receives only reconciled trigger registrations from this store.
 */
export class SqliteScheduledTaskStore {
  constructor(private readonly db: Database.Database) { this.ensureSchema(); }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS zhiyuan_scheduled_tasks (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
        enabled INTEGER NOT NULL, schedule_json TEXT NOT NULL, session_target TEXT NOT NULL,
        wake_mode TEXT NOT NULL, payload_json TEXT NOT NULL, delivery_json TEXT NOT NULL,
        agent_id TEXT NOT NULL, session_key TEXT, schedule_version TEXT NOT NULL,
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
    `);
  }

  create(input: ScheduledTaskInput): ScheduledTask {
    return this.createWithId(randomUUID(), input);
  }

  /** Imports a legacy task with its stable id so existing Run history remains addressable. */
  importLegacy(id: string, input: ScheduledTaskInput): ScheduledTask {
    const existing = this.get(id);
    if (existing) return existing;
    return this.createWithId(id, input);
  }

  private createWithId(id: string, input: ScheduledTaskInput): ScheduledTask {
    const now = new Date().toISOString();
    const task = this.toTask({
      id, name: input.name, description: input.description, enabled: input.enabled,
      schedule: input.schedule, sessionTarget: input.sessionTarget, wakeMode: input.wakeMode,
      payload: input.payload, delivery: input.delivery ?? { mode: DeliveryMode.None },
      agentId: input.agentId, sessionKey: input.sessionKey ?? null, state: initialState(),
      createdAt: now, updatedAt: now,
    });
    this.insert(task);
    return task;
  }

  update(id: string, patch: Partial<ScheduledTaskInput>): ScheduledTask {
    const current = this.get(id);
    if (!current) throw new Error(`Scheduled task not found: ${id}`);
    const triggerDefinitionChanged = patch.enabled !== undefined || patch.schedule !== undefined;
    const next = this.toTask({
      ...current, ...patch, delivery: patch.delivery ?? current.delivery,
      sessionKey: patch.sessionKey === undefined ? current.sessionKey : patch.sessionKey,
      ...(triggerDefinitionChanged ? { scheduleVersion: undefined } : {}),
      updatedAt: new Date().toISOString(),
    });
    this.insert(next);
    return next;
  }

  remove(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM zhiyuan_scheduled_task_runs WHERE task_id = ?').run(id);
      this.db.prepare('DELETE FROM zhiyuan_scheduled_tasks WHERE id = ?').run(id);
    })();
  }

  get(id: string): ScheduledTask | null {
    const row = this.db.prepare('SELECT * FROM zhiyuan_scheduled_tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? this.fromRow(row) : null;
  }

  list(): ScheduledTask[] {
    return (this.db.prepare('SELECT * FROM zhiyuan_scheduled_tasks ORDER BY created_at DESC').all() as TaskRow[])
      .map(row => this.fromRow(row));
  }

  /** Atomically rejects a duplicate sidecar trigger before a Pi Run is created. */
  claimTrigger(input: { taskId: string; scheduleVersion: string; scheduledAt: string }): ScheduledTaskRun | null {
    const task = this.get(input.taskId);
    if (!task || !task.enabled || task.scheduleVersion !== input.scheduleVersion) return null;
    const run: ScheduledTaskRun = {
      id: randomUUID(), taskId: task.id, sessionId: null, sessionKey: task.sessionKey,
      status: 'running' as TaskStatus, startedAt: new Date().toISOString(), finishedAt: null,
      durationMs: null, error: null,
    };
    try {
      this.db.prepare(`INSERT INTO zhiyuan_scheduled_task_runs
        (id, task_id, schedule_version, scheduled_at, session_id, session_key, status, started_at, finished_at, duration_ms, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(run.id, run.taskId, input.scheduleVersion, input.scheduledAt, run.sessionId, run.sessionKey,
          run.status, run.startedAt, null, null, null);
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) return null;
      throw error;
    }
    return run;
  }

  finishRun(id: string, result: { status: TaskStatus; sessionId?: string | null; error?: string | null }): ScheduledTaskRun {
    const row = this.db.prepare('SELECT * FROM zhiyuan_scheduled_task_runs WHERE id = ?').get(id) as RunRow | undefined;
    if (!row) throw new Error(`Scheduled task run not found: ${id}`);
    const finishedAt = new Date().toISOString();
    const durationMs = Date.parse(finishedAt) - Date.parse(row.started_at);
    this.db.prepare(`UPDATE zhiyuan_scheduled_task_runs
      SET status = ?, session_id = ?, finished_at = ?, duration_ms = ?, error = ? WHERE id = ?`)
      .run(result.status, result.sessionId ?? null, finishedAt, durationMs, result.error ?? null, id);
    const state = this.get(row.task_id)?.state ?? initialState();
    state.runningAtMs = null; state.lastRunAtMs = Date.parse(finishedAt); state.lastStatus = result.status;
    state.lastError = result.error ?? null; state.lastDurationMs = durationMs;
    state.consecutiveErrors = result.status === TaskStatus.Error ? state.consecutiveErrors + 1 : 0;
    this.db.prepare('UPDATE zhiyuan_scheduled_tasks SET state_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(state), finishedAt, row.task_id);
    return { id, taskId: row.task_id, sessionId: result.sessionId ?? null, sessionKey: row.session_key,
      status: result.status, startedAt: row.started_at, finishedAt, durationMs, error: result.error ?? null };
  }

  /** Imports immutable historical Run data without invoking a runtime. */
  importLegacyRun(run: ScheduledTaskRun): void {
    this.db.prepare(`INSERT OR IGNORE INTO zhiyuan_scheduled_task_runs
      (id, task_id, schedule_version, scheduled_at, session_id, session_key, status, started_at, finished_at, duration_ms, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(run.id, run.taskId, 'legacy', run.startedAt, run.sessionId, run.sessionKey, run.status,
        run.startedAt, run.finishedAt, run.durationMs, run.error);
  }

  listRuns(taskId: string): ScheduledTaskRun[] {
    return (this.db.prepare('SELECT * FROM zhiyuan_scheduled_task_runs WHERE task_id = ? ORDER BY started_at DESC').all(taskId) as RunRow[])
      .map(row => this.runFromRow(row));
  }

  listRunsWithName(): ScheduledTaskRunWithName[] {
    const rows = this.db.prepare(`SELECT r.*, t.name FROM zhiyuan_scheduled_task_runs r
      JOIN zhiyuan_scheduled_tasks t ON t.id = r.task_id ORDER BY r.started_at DESC`).all() as Array<RunRow & { name: string }>;
    return rows.map(row => ({ ...this.runFromRow(row), taskName: row.name }));
  }

  private insert(task: ScheduledTask): void {
    this.db.prepare(`INSERT INTO zhiyuan_scheduled_tasks
      (id, name, description, enabled, schedule_json, session_target, wake_mode, payload_json, delivery_json, agent_id, session_key, schedule_version, state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, enabled=excluded.enabled,
      schedule_json=excluded.schedule_json, session_target=excluded.session_target, wake_mode=excluded.wake_mode,
      payload_json=excluded.payload_json, delivery_json=excluded.delivery_json, agent_id=excluded.agent_id,
      session_key=excluded.session_key, schedule_version=excluded.schedule_version, state_json=excluded.state_json, updated_at=excluded.updated_at`)
      .run(task.id, task.name, task.description, task.enabled ? 1 : 0, JSON.stringify(task.schedule), task.sessionTarget,
        task.wakeMode, JSON.stringify(task.payload), JSON.stringify(task.delivery), task.agentId, task.sessionKey,
        task.scheduleVersion, JSON.stringify(task.state), task.createdAt, task.updatedAt);
  }

  private toTask(task: Omit<ScheduledTask, 'scheduleVersion'> & { scheduleVersion?: string }): ScheduledTask {
    if (!task.name.trim() || !task.agentId.trim()) throw new Error('Scheduled task name and agentId are required');
    const scheduleVersion = task.scheduleVersion ?? scheduleVersionOf(task);
    return { ...task, scheduleVersion };
  }

  private fromRow(row: TaskRow): ScheduledTask {
    return { id: row.id, name: row.name, description: row.description, enabled: row.enabled === 1,
      schedule: JSON.parse(row.schedule_json), sessionTarget: row.session_target as ScheduledTask['sessionTarget'],
      wakeMode: row.wake_mode as ScheduledTask['wakeMode'], payload: JSON.parse(row.payload_json),
      delivery: JSON.parse(row.delivery_json), agentId: row.agent_id, sessionKey: row.session_key,
      scheduleVersion: row.schedule_version, state: JSON.parse(row.state_json), createdAt: row.created_at, updatedAt: row.updated_at };
  }
  private runFromRow(row: RunRow): ScheduledTaskRun {
    return { id: row.id, taskId: row.task_id, sessionId: row.session_id, sessionKey: row.session_key,
      status: row.status as TaskStatus, startedAt: row.started_at, finishedAt: row.finished_at,
      durationMs: row.duration_ms, error: row.error };
  }
}

function scheduleVersionOf(task: Omit<ScheduledTask, 'scheduleVersion'>): string {
  return createHash('sha256').update(JSON.stringify({ enabled: task.enabled, schedule: task.schedule })).digest('hex');
}
