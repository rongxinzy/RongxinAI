import { createHash, randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import { DeliveryMode, TaskStatus } from './constants';
import type {
  RunFilter,
  ScheduledTask,
  ScheduledTaskDeliveryRecord,
  ScheduledTaskInput,
  ScheduledTaskRun,
  ScheduledTaskRunWithName,
  TaskState,
} from './types';

type TaskRow = {
  id: string;
  name: string;
  description: string;
  enabled: number;
  schedule_json: string;
  session_target: string;
  wake_mode: string;
  payload_json: string;
  delivery_json: string;
  workspace_id: string | null;
  session_key: string | null;
  schedule_version: string;
  running_at: string | null;
  last_finished_at: string | null;
  last_status: TaskStatus | null;
  last_error: string | null;
  last_duration_ms: number | null;
  consecutive_errors: number;
  created_at: string;
  updated_at: string;
};
type RunRow = {
  id: string;
  task_id: string;
  schedule_version: string;
  scheduled_at: string | null;
  session_id: string | null;
  session_key: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
};
type RunCompletion = {
  status: TaskStatus;
  sessionId?: string | null;
  error?: string | null;
  replyPreview?: string | null;
};
type DeliveryRow = {
  id: string;
  run_id: string;
  task_id: string;
  mode: string;
  channel: string | null;
  destination: string | null;
  account_id: string | null;
  status: string;
  attempted_at: string;
  delivered_at: string | null;
  receipt_id: string | null;
  error: string | null;
};

const initialState = (): TaskState => ({
  nextRunAtMs: null,
  lastRunAtMs: null,
  lastStatus: null,
  lastError: null,
  lastDurationMs: null,
  runningAtMs: null,
  consecutiveErrors: 0,
});

const TASK_PROJECTION = `
  SELECT t.id, t.name, t.description, t.enabled, t.schedule_json, t.session_target, t.wake_mode,
    t.payload_json, t.delivery_json, t.workspace_id, t.session_key, t.schedule_version, t.created_at,
    MAX(t.updated_at, COALESCE(last.finished_at, ''), COALESCE(active.started_at, '')) AS updated_at,
    last.finished_at AS last_finished_at, last.status AS last_status,
    last.error AS last_error, last.duration_ms AS last_duration_ms,
    active.started_at AS running_at,
    CASE WHEN last.status = '${TaskStatus.Error}' THEN (
      SELECT COUNT(*) FROM zhiyuan_scheduled_task_runs failed
      WHERE failed.task_id = t.id AND failed.status = '${TaskStatus.Error}'
        AND failed.finished_at IS NOT NULL
        AND (failed.finished_at, failed.rowid) >
            (COALESCE(reset.finished_at, ''), COALESCE(reset.rowid, 0))
    ) ELSE 0 END AS consecutive_errors
  FROM zhiyuan_scheduled_tasks t
  LEFT JOIN zhiyuan_scheduled_task_runs active ON active.rowid = (
    SELECT r.rowid FROM zhiyuan_scheduled_task_runs r
    WHERE r.task_id = t.id AND r.status = '${TaskStatus.Running}'
    ORDER BY r.started_at DESC LIMIT 1
  )
  LEFT JOIN zhiyuan_scheduled_task_runs last ON last.rowid = (
    SELECT r.rowid FROM zhiyuan_scheduled_task_runs r
    WHERE r.task_id = t.id AND r.finished_at IS NOT NULL
    ORDER BY r.finished_at DESC, r.rowid DESC LIMIT 1
  )
  LEFT JOIN zhiyuan_scheduled_task_runs reset ON last.status = '${TaskStatus.Error}' AND reset.rowid = (
    SELECT r.rowid FROM zhiyuan_scheduled_task_runs r
    WHERE r.task_id = t.id AND r.finished_at IS NOT NULL AND r.status <> '${TaskStatus.Error}'
    ORDER BY r.finished_at DESC, r.rowid DESC LIMIT 1
  )`;

/**
 * Canonical durable scheduler state. cc-connect is deliberately not referenced
 * here: it receives only reconciled trigger registrations from this store.
 */
export class SqliteScheduledTaskStore {
  constructor(private readonly db: Database.Database) {}

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
      id,
      name: input.name,
      description: input.description,
      enabled: input.enabled,
      schedule: input.schedule,
      sessionTarget: input.sessionTarget,
      wakeMode: input.wakeMode,
      payload: input.payload,
      delivery: input.delivery ?? { mode: DeliveryMode.None },
      workspaceId: input.workspaceId ?? null,
      sessionKey: input.sessionKey ?? null,
      state: initialState(),
      createdAt: now,
      updatedAt: now,
    });
    this.insert(task);
    return task;
  }

  update(id: string, patch: Partial<ScheduledTaskInput>): ScheduledTask {
    const current = this.get(id);
    if (!current) throw new Error(`Scheduled task not found: ${id}`);
    const triggerDefinitionChanged = patch.enabled !== undefined || patch.schedule !== undefined;
    const next = this.toTask({
      ...current,
      ...patch,
      delivery: patch.delivery ?? current.delivery,
      sessionKey: patch.sessionKey === undefined ? current.sessionKey : patch.sessionKey,
      ...(triggerDefinitionChanged ? { scheduleVersion: undefined } : {}),
      updatedAt: new Date().toISOString(),
    });
    this.insert(next);
    return next;
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM zhiyuan_scheduled_tasks WHERE id = ?').run(id);
  }

  get(id: string): ScheduledTask | null {
    const row = this.db.prepare(`${TASK_PROJECTION} WHERE t.id = ?`).get(id) as TaskRow | undefined;
    return row ? this.fromRow(row) : null;
  }

  list(): ScheduledTask[] {
    return (
      this.db.prepare(`${TASK_PROJECTION} ORDER BY t.created_at DESC`).all() as TaskRow[]
    ).map(row => this.fromRow(row));
  }

  /**
   * Atomically rejects a duplicate sidecar trigger before a Pi Run is created.
   * Manual invocations may run a paused task exactly once, so they opt out of
   * the enabled guard while still taking a unique Run slot.
   */
  claimTrigger(
    input: {
      taskId: string;
      scheduleVersion: string;
      scheduledAt: string;
    },
    options: { allowDisabled?: boolean } = {},
  ): ScheduledTaskRun | null {
    const row = this.db
      .prepare(`INSERT INTO zhiyuan_scheduled_task_runs
        (id, task_id, schedule_version, scheduled_at, session_key, status, started_at, task_name)
        SELECT ?, id, schedule_version, ?, session_key, ?, ?, name FROM zhiyuan_scheduled_tasks
        WHERE id = ? AND schedule_version = ? AND (enabled = 1 OR ?)
        ON CONFLICT(task_id, schedule_version, scheduled_at) DO NOTHING
        RETURNING *`)
      .get(
        randomUUID(),
        input.scheduledAt,
        TaskStatus.Running,
        new Date().toISOString(),
        input.taskId,
        input.scheduleVersion,
        options.allowDisabled ? 1 : 0,
      ) as RunRow | undefined;
    return row ? this.runFromRow(row) : null;
  }

  finishRun(id: string, result: RunCompletion): ScheduledTaskRun {
    const row = this.db
      .prepare('SELECT * FROM zhiyuan_scheduled_task_runs WHERE id = ?')
      .get(id) as RunRow | undefined;
    if (!row) throw new Error(`Scheduled task run not found: ${id}`);
    return this.completeRun(row, result, new Date().toISOString());
  }

  private completeRun(row: RunRow, result: RunCompletion, finishedAt: string): ScheduledTaskRun {
    const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(row.started_at));
    this.db
      .prepare(`UPDATE zhiyuan_scheduled_task_runs
      SET status = ?, session_id = ?, finished_at = ?, duration_ms = ?, error = ?,
        reply_preview = ? WHERE id = ?`)
      .run(
        result.status,
        result.sessionId ?? null,
        finishedAt,
        durationMs,
        result.error ?? null,
        result.replyPreview ?? null,
        row.id,
      );
    return {
      id: row.id,
      taskId: row.task_id,
      sessionId: result.sessionId ?? null,
      sessionKey: row.session_key,
      status: result.status,
      startedAt: row.started_at,
      finishedAt,
      durationMs,
      error: result.error ?? null,
    };
  }

  /** Imports immutable historical Run data without invoking a runtime. */
  importLegacyRun(run: ScheduledTaskRun): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO zhiyuan_scheduled_task_runs
      (id, task_id, schedule_version, scheduled_at, session_id, session_key, status, started_at, finished_at, duration_ms, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        run.id,
        run.taskId,
        'legacy',
        run.startedAt,
        run.sessionId,
        run.sessionKey,
        run.status,
        run.startedAt,
        run.finishedAt,
        run.durationMs,
        run.error,
      );
  }

  listRuns(
    taskId: string,
    limit = Number.MAX_SAFE_INTEGER,
    offset = 0,
    filter?: RunFilter,
  ): ScheduledTaskRun[] {
    return this.readRunPage<RunRow>(taskId, limit, offset, filter).map(row => this.runFromRow(row));
  }

  listRunsWithName(
    limit = Number.MAX_SAFE_INTEGER,
    offset = 0,
    filter?: RunFilter,
  ): ScheduledTaskRunWithName[] {
    return this.readRunPage<RunRow & { name: string }>(null, limit, offset, filter).map(row => ({
      ...this.runFromRow(row),
      taskName: row.name,
    }));
  }

  private readRunPage<Row extends RunRow>(
    taskId: string | null,
    limit: number,
    offset: number,
    filter?: RunFilter,
  ): Row[] {
    const conditions: string[] = [];
    const bindings: Array<string | number> = [];
    if (taskId !== null) {
      conditions.push('r.task_id = ?');
      bindings.push(taskId);
    }
    if (filter?.status) {
      conditions.push('r.status = ?');
      bindings.push(filter.status);
    }
    // Date filters use the same local calendar boundaries as the history view.
    const fromMs = filter?.startDate ? Date.parse(`${filter.startDate}T00:00:00`) : NaN;
    const untilMs = filter?.endDate ? Date.parse(`${filter.endDate}T23:59:59.999`) : NaN;
    if (Number.isFinite(fromMs)) {
      conditions.push("unixepoch(r.started_at, 'subsec') >= ?");
      bindings.push(fromMs / 1000);
    }
    if (Number.isFinite(untilMs)) {
      conditions.push("unixepoch(r.started_at, 'subsec') <= ?");
      bindings.push(untilMs / 1000);
    }
    const named = taskId === null;
    const source = `FROM zhiyuan_scheduled_task_runs r
      ${named ? 'JOIN zhiyuan_scheduled_tasks t ON t.id = r.task_id' : ''}
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`;
    let start = Math.trunc(offset);
    let end = Math.trunc(offset + limit);
    // Preserve relative slice offsets without pulling the history into JavaScript.
    if (start < 0 || end < 0) {
      const { total } = this.db.prepare(`SELECT COUNT(*) AS total ${source}`).get(...bindings) as {
        total: number;
      };
      if (start < 0) start = Math.max(0, total + start);
      if (end < 0) end = Math.max(0, total + end);
    }
    const length = Math.min(end - start, Number.MAX_SAFE_INTEGER);
    if (!(length > 0) || start > Number.MAX_SAFE_INTEGER) return [];
    return this.db
      .prepare(`SELECT r.*${named ? ', t.name' : ''} ${source}
        ORDER BY r.started_at DESC, r.rowid ASC LIMIT ? OFFSET ?`)
      .all(...bindings, length, start) as Row[];
  }

  createDelivery(
    input: Omit<ScheduledTaskDeliveryRecord, 'id' | 'attemptedAt'> & { attemptedAt?: string },
  ): ScheduledTaskDeliveryRecord {
    const delivery: ScheduledTaskDeliveryRecord = {
      ...input,
      id: randomUUID(),
      attemptedAt: input.attemptedAt ?? new Date().toISOString(),
    };
    this.db
      .prepare(`INSERT INTO zhiyuan_scheduled_task_deliveries
      (id, run_id, task_id, mode, channel, destination, account_id, status, attempted_at, delivered_at, receipt_id, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        delivery.id,
        delivery.runId,
        delivery.taskId,
        delivery.mode,
        delivery.channel,
        delivery.to,
        delivery.accountId,
        delivery.status,
        delivery.attemptedAt,
        delivery.deliveredAt,
        delivery.receiptId,
        delivery.error,
      );
    return delivery;
  }

  listDeliveries(runId: string): ScheduledTaskDeliveryRecord[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM zhiyuan_scheduled_task_deliveries WHERE run_id = ? ORDER BY attempted_at DESC',
        )
        .all(runId) as DeliveryRow[]
    ).map(row => this.deliveryFromRow(row));
  }

  finishDelivery(
    id: string,
    result: Pick<ScheduledTaskDeliveryRecord, 'status' | 'deliveredAt' | 'receiptId' | 'error'>,
  ): ScheduledTaskDeliveryRecord {
    const row = this.db
      .prepare(`UPDATE zhiyuan_scheduled_task_deliveries
      SET status = ?, delivered_at = ?, receipt_id = ?, error = ? WHERE id = ?
      RETURNING *`)
      .get(result.status, result.deliveredAt, result.receiptId, result.error, id) as
      | DeliveryRow
      | undefined;
    if (!row) throw new Error(`Scheduled task delivery not found: ${id}`);
    return this.deliveryFromRow(row);
  }

  /** Makes crash-interrupted execution visible instead of leaving a permanent running Run. */
  recoverInterruptedRuns(): number {
    return this.db.transaction(() => {
      const finishedAt = new Date().toISOString();
      const rows = this.db
        .prepare('SELECT * FROM zhiyuan_scheduled_task_runs WHERE status = ?')
        .all(TaskStatus.Running) as RunRow[];
      for (const row of rows) {
        this.completeRun(
          row,
          {
            status: TaskStatus.Error,
            sessionId: row.session_id,
            error: 'Scheduler interrupted before Pi completion',
          },
          finishedAt,
        );
      }
      return rows.length;
    })();
  }

  private insert(task: ScheduledTask): void {
    // The historic NOT NULL snapshot column is left inert for existing databases.
    this.db
      .prepare(`INSERT INTO zhiyuan_scheduled_tasks
      (id, name, description, enabled, schedule_json, session_target, wake_mode, payload_json, delivery_json, workspace_id, session_key, schedule_version, state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, enabled=excluded.enabled,
      schedule_json=excluded.schedule_json, session_target=excluded.session_target, wake_mode=excluded.wake_mode,
      payload_json=excluded.payload_json, delivery_json=excluded.delivery_json, workspace_id=excluded.workspace_id,
      session_key=excluded.session_key, schedule_version=excluded.schedule_version, updated_at=excluded.updated_at`)
      .run(
        task.id,
        task.name,
        task.description,
        task.enabled ? 1 : 0,
        JSON.stringify(task.schedule),
        task.sessionTarget,
        task.wakeMode,
        JSON.stringify(task.payload),
        JSON.stringify(task.delivery),
        task.workspaceId,
        task.sessionKey,
        task.scheduleVersion,
        task.createdAt,
        task.updatedAt,
      );
  }

  private toTask(
    task: Omit<ScheduledTask, 'scheduleVersion'> & { scheduleVersion?: string },
  ): ScheduledTask {
    if (!task.name.trim()) throw new Error('Scheduled task name is required');
    const scheduleVersion = task.scheduleVersion ?? scheduleVersionOf(task);
    return { ...task, scheduleVersion };
  }

  private fromRow(row: TaskRow): ScheduledTask {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      enabled: row.enabled === 1,
      schedule: JSON.parse(row.schedule_json),
      sessionTarget: row.session_target as ScheduledTask['sessionTarget'],
      wakeMode: row.wake_mode as ScheduledTask['wakeMode'],
      payload: JSON.parse(row.payload_json),
      delivery: JSON.parse(row.delivery_json),
      workspaceId: row.workspace_id,
      sessionKey: row.session_key,
      scheduleVersion: row.schedule_version,
      state: {
        nextRunAtMs: null,
        lastRunAtMs: row.last_finished_at === null ? null : Date.parse(row.last_finished_at),
        lastStatus: row.last_status,
        lastError: row.last_error,
        lastDurationMs: row.last_duration_ms,
        runningAtMs: row.running_at === null ? null : Date.parse(row.running_at),
        consecutiveErrors: row.consecutive_errors,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  private runFromRow(row: RunRow): ScheduledTaskRun {
    return {
      id: row.id,
      taskId: row.task_id,
      sessionId: row.session_id,
      sessionKey: row.session_key,
      status: row.status as TaskStatus,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      error: row.error,
    };
  }
  private deliveryFromRow(row: DeliveryRow): ScheduledTaskDeliveryRecord {
    return {
      id: row.id,
      runId: row.run_id,
      taskId: row.task_id,
      mode: row.mode as DeliveryMode,
      channel: row.channel,
      to: row.destination,
      accountId: row.account_id,
      status: row.status as ScheduledTaskDeliveryRecord['status'],
      attemptedAt: row.attempted_at,
      deliveredAt: row.delivered_at,
      receiptId: row.receipt_id,
      error: row.error,
    };
  }
}

function scheduleVersionOf(task: Omit<ScheduledTask, 'scheduleVersion'>): string {
  return createHash('sha256')
    .update(JSON.stringify({ enabled: task.enabled, schedule: task.schedule }))
    .digest('hex');
}
