import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { normalizeHarnessModelFields } from '../harness/modelProfile';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalEffectStatus,
  WorkbenchArtifactKind,
  type WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
  WorkbenchRunEventType,
  WorkbenchExecutionStatus,
  WorkbenchTerminalExecutionStatuses,
  type WorkbenchApproval,
  type WorkbenchApprovalDecisionSource,
  type WorkbenchApprovalRiskLevel,
  type WorkbenchArtifact,
  type WorkbenchArtifactProvenance,
  type WorkbenchJsonObject,
  type WorkbenchRun,
  type WorkbenchRunContext,
  type WorkbenchRunEvent,
  type WorkbenchExecutionStatus as WorkbenchExecutionStatusType,
  type WorkbenchRunTrigger,
  type WorkbenchTask,
  type WorkbenchTaskContract,
  type WorkbenchTaskDetail,
} from '../../shared/workbenchTask';

const terminalTaskStatuses = new Set<string>(WorkbenchTerminalExecutionStatuses);
const terminalRunEventTypes: Partial<
  Record<WorkbenchExecutionStatusType, WorkbenchRunEvent['type']>
> = {
  [WorkbenchExecutionStatus.Settled]: WorkbenchRunEventType.RunSettled,
  [WorkbenchExecutionStatus.Failed]: WorkbenchRunEventType.RunFailed,
  [WorkbenchExecutionStatus.Cancelled]: WorkbenchRunEventType.RunCancelled,
};
const executionStatuses = new Set<string>(Object.values(WorkbenchExecutionStatus));
const currentStatuses = [...executionStatuses].map(status => `'${status}'`).join(', ');
const activeStatuses = `'${WorkbenchExecutionStatus.Queued}', '${WorkbenchExecutionStatus.Running}'`;
const TASK_WITH_CURRENT_RUN = `
  FROM workbench_tasks t
  LEFT JOIN workbench_runs r ON r.id = (
    SELECT id FROM workbench_runs WHERE task_id = t.id AND status IN (${currentStatuses})
    ORDER BY attempt DESC LIMIT 1
  )
  WHERE (r.id IS NOT NULL OR t.status IN (${currentStatuses}))`;
const LATEST_TASK_ORDER = 'ORDER BY t.created_at DESC, t.rowid DESC LIMIT 1';
const LATEST_SESSION_TASK = `AND t.session_id = ? ${LATEST_TASK_ORDER}`;
// Read the old task state only for historical tasks without a run.
const TASK_PROJECTION = `
  SELECT t.id, t.session_id, t.goal, t.contract_json, t.created_at,
    COALESCE(r.status, t.status) AS status,
    CASE WHEN r.id IS NULL THEN t.active_run_id
         WHEN r.status IN (${activeStatuses}) THEN r.id END AS active_run_id,
    COALESCE(r.updated_at, t.updated_at) AS updated_at,
    CASE WHEN r.id IS NULL THEN t.completed_at ELSE r.ended_at END AS completed_at
  ${TASK_WITH_CURRENT_RUN}`;

const parseJson = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

type TaskRow = {
  id: string;
  session_id: string;
  goal: string;
  status: WorkbenchExecutionStatusType;
  contract_json: string;
  active_run_id: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type RunRow = {
  id: string;
  task_id: string;
  attempt: number;
  status: WorkbenchExecutionStatusType;
  trigger: WorkbenchRunTrigger;
  started_at: number | null;
  ended_at: number | null;
  context_json: string | null;
  failure_json: string | null;
  terminal_after_sequence: number | null;
  created_at: number;
  updated_at: number;
};

type EventRow = {
  id: string;
  run_id: string;
  sequence: number;
  type: WorkbenchRunEvent['type'];
  payload_json: string;
  created_at: number;
};

type ArtifactRow = {
  id: string;
  task_id: string;
  run_id: string;
  kind: WorkbenchArtifactKind;
  mime_type: string;
  reference: string;
  content_hash: string;
  provenance: WorkbenchArtifactProvenance;
  verification_status: WorkbenchArtifactVerificationStatus;
  metadata_json: string;
  created_at: number;
  updated_at: number;
};

type ApprovalRow = {
  id: string;
  task_id: string;
  run_id: string;
  tool_call_id: string;
  tool_name: string;
  risk_level: WorkbenchApprovalRiskLevel;
  decision: WorkbenchApproval['decision'];
  decision_source: WorkbenchApprovalDecisionSource | null;
  effect_status: WorkbenchApproval['effectStatus'];
  idempotency_key: string;
  request_json: string;
  result_json: string | null;
  created_at: number;
  updated_at: number;
  decided_at: number | null;
};

export class WorkbenchTaskRepository {
  private readonly hasHistoricalArtifacts: boolean;

  constructor(private readonly db: Database.Database) {
    this.hasHistoricalArtifacts = Boolean(
      db
        .prepare(
          "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'workbench_artifacts'",
        )
        .get(),
    );
  }

  transaction<T>(operation: () => T): T {
    return this.db.transaction(operation)();
  }

  createTask(
    sessionId: string,
    goal: string,
    contract: WorkbenchTaskContract,
    id: string = randomUUID(),
  ): WorkbenchTask {
    const now = Date.now();
    const task: WorkbenchTask = {
      id,
      sessionId,
      goal,
      status: WorkbenchExecutionStatus.Queued,
      contract,
      activeRunId: null,
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO workbench_tasks
         (id, session_id, goal, status, contract_json, active_run_id, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.sessionId,
        task.goal,
        task.status,
        JSON.stringify(task.contract),
        task.activeRunId,
        task.createdAt,
        task.updatedAt,
        task.endedAt,
      );
    return task;
  }

  getTask(taskId: string): WorkbenchTask | null {
    const row = this.db.prepare(`${TASK_PROJECTION} AND t.id = ?`).get(taskId) as
      | TaskRow
      | undefined;
    return row ? this.mapTask(row) : null;
  }

  getLatestTaskForSession(sessionId: string): WorkbenchTask | null {
    const row = this.db.prepare(`${TASK_PROJECTION} ${LATEST_SESSION_TASK}`).get(sessionId) as
      | TaskRow
      | undefined;
    return row ? this.mapTask(row) : null;
  }

  getLatestTaskStatuses(sessionIds: readonly string[]): Map<string, WorkbenchExecutionStatusType> {
    const rows = this.db
      .prepare<[string], { sessionId: string; status: WorkbenchExecutionStatusType | null }>(`
        SELECT ids.value AS sessionId, (
          SELECT COALESCE(r.status, t.status)
          ${TASK_WITH_CURRENT_RUN} AND t.session_id = ids.value ${LATEST_TASK_ORDER}
        ) AS status
        FROM json_each(?) ids`)
      .all(JSON.stringify(sessionIds));
    const statuses = new Map<string, WorkbenchExecutionStatusType>();
    for (const row of rows) {
      if (row.status !== null) statuses.set(row.sessionId, row.status);
    }
    return statuses;
  }

  getLatestRunLinkForSession(sessionId: string): { taskId: string; runId: string } | null {
    const row = this.db
      .prepare<[string], { taskId: string; runId: string | null }>(`
        SELECT t.id AS taskId, r.id AS runId
        ${TASK_WITH_CURRENT_RUN} ${LATEST_SESSION_TASK}`)
      .get(sessionId);
    return row?.runId ? { taskId: row.taskId, runId: row.runId } : null;
  }

  listTasksForSession(sessionId: string): WorkbenchTask[] {
    const rows = this.db
      .prepare(`${TASK_PROJECTION} AND t.session_id = ? ORDER BY t.created_at DESC`)
      .all(sessionId) as TaskRow[];
    return rows.map(row => this.mapTask(row));
  }

  getActiveTaskForSession(sessionId: string): WorkbenchTask | null {
    const row = this.db
      .prepare(`${TASK_PROJECTION} AND t.session_id = ?
        AND r.status IN (${activeStatuses})
        ORDER BY t.created_at DESC, t.rowid DESC LIMIT 1`)
      .get(sessionId) as TaskRow | undefined;
    return row ? this.mapTask(row) : null;
  }

  listInterruptedRuns(): Array<{ id: string; sessionId: string; startedAt: number | null }> {
    return this.db
      .prepare(`SELECT r.id, t.session_id AS sessionId, r.started_at AS startedAt
        FROM workbench_runs r JOIN workbench_tasks t ON t.id = r.task_id
        WHERE r.status IN (?, ?)`)
      .all(WorkbenchExecutionStatus.Queued, WorkbenchExecutionStatus.Running) as Array<{
      id: string;
      sessionId: string;
      startedAt: number | null;
    }>;
  }

  cancelInterruptedTasksWithoutRuns(): void {
    const now = Date.now();
    this.db
      .prepare(`UPDATE workbench_tasks AS t SET status = ?, active_run_id = NULL,
        completed_at = ?, updated_at = ? WHERE status IN (?, ?)
        AND NOT EXISTS (SELECT 1 FROM workbench_runs r
          WHERE r.task_id = t.id AND r.status IN (${currentStatuses}))`)
      .run(
        WorkbenchExecutionStatus.Cancelled,
        now,
        now,
        WorkbenchExecutionStatus.Queued,
        WorkbenchExecutionStatus.Running,
      );
  }

  createRun(taskId: string, trigger: WorkbenchRunTrigger, id: string = randomUUID()): WorkbenchRun {
    const now = Date.now();
    const attemptRow = this.db
      .prepare(
        'SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt FROM workbench_runs WHERE task_id = ?',
      )
      .get(taskId) as { attempt: number };
    const run: WorkbenchRun = {
      id,
      taskId,
      attempt: attemptRow.attempt,
      status: WorkbenchExecutionStatus.Queued,
      trigger,
      startedAt: null,
      endedAt: null,
      context: null,
      failure: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO workbench_runs
         (id, task_id, attempt, status, trigger, started_at, ended_at,
          context_json, failure_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.taskId,
        run.attempt,
        run.status,
        run.trigger,
        null,
        null,
        null,
        null,
        now,
        now,
      );
    return run;
  }

  getRun(runId: string): WorkbenchRun | null {
    const row = this.db.prepare('SELECT * FROM workbench_runs WHERE id = ?').get(runId) as
      | RunRow
      | undefined;
    return row && executionStatuses.has(row.status) ? this.mapRun(row) : null;
  }

  updateRunContext(runId: string, context: WorkbenchRunContext): WorkbenchRun {
    this.requireRun(runId);
    this.db
      .prepare('UPDATE workbench_runs SET context_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(context), Date.now(), runId);
    return this.requireRun(runId);
  }

  updateRunStatus(
    runId: string,
    status: WorkbenchExecutionStatusType,
    options: {
      failure?: WorkbenchJsonObject | null;
    } = {},
  ): WorkbenchRun {
    const current = this.requireRun(runId);
    const now = Date.now();
    const startedAt =
      status === WorkbenchExecutionStatus.Running && current.startedAt === null
        ? now
        : current.startedAt;
    const terminal = terminalTaskStatuses.has(status);
    const endedAt = terminal ? now : current.endedAt;
    const failure = options.failure === undefined ? current.failure : options.failure;
    this.db
      .prepare(
        `UPDATE workbench_runs
         SET status = ?, started_at = ?, ended_at = ?, failure_json = ?, updated_at = ?,
           terminal_after_sequence = CASE WHEN ? THEN COALESCE(terminal_after_sequence, (
             SELECT COALESCE(MAX(sequence), 0) FROM workbench_run_events
             WHERE run_id = workbench_runs.id
           )) ELSE terminal_after_sequence END
         WHERE id = ?`,
      )
      .run(
        status,
        startedAt,
        endedAt,
        failure ? JSON.stringify(failure) : null,
        now,
        Number(terminal),
        runId,
      );
    return this.requireRun(runId);
  }

  appendRunEvent(
    runId: string,
    type: WorkbenchRunEvent['type'],
    payload: WorkbenchJsonObject = {},
  ): WorkbenchRunEvent {
    const sequenceRow = this.db
      .prepare(
        'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM workbench_run_events WHERE run_id = ?',
      )
      .get(runId) as { sequence: number };
    const event: WorkbenchRunEvent = {
      id: randomUUID(),
      runId,
      sequence: sequenceRow.sequence,
      type,
      payload,
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO workbench_run_events (id, run_id, sequence, type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(event.id, runId, event.sequence, event.type, JSON.stringify(payload), event.createdAt);
    return event;
  }

  createApproval(
    input: Pick<
      WorkbenchApproval,
      | 'taskId'
      | 'runId'
      | 'toolCallId'
      | 'toolName'
      | 'riskLevel'
      | 'decision'
      | 'decisionSource'
      | 'effectStatus'
      | 'idempotencyKey'
      | 'request'
    > & { id?: string },
  ): WorkbenchApproval {
    const existing = this.getApprovalByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const now = Date.now();
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO workbench_approvals
         (id, task_id, run_id, tool_call_id, tool_name, risk_level, decision,
          decision_source, effect_status, idempotency_key, request_json, result_json,
          created_at, updated_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.taskId,
        input.runId,
        input.toolCallId,
        input.toolName,
        input.riskLevel,
        input.decision,
        input.decisionSource,
        input.effectStatus,
        input.idempotencyKey,
        JSON.stringify(input.request),
        null,
        now,
        now,
        input.decision === WorkbenchApprovalDecision.Pending ? null : now,
      );
    return this.requireApproval(id);
  }

  getApproval(approvalId: string): WorkbenchApproval | null {
    const row = this.db
      .prepare('SELECT * FROM workbench_approvals WHERE id = ?')
      .get(approvalId) as ApprovalRow | undefined;
    return row ? this.mapApproval(row) : null;
  }

  getApprovalByIdempotencyKey(idempotencyKey: string): WorkbenchApproval | null {
    const row = this.db
      .prepare('SELECT * FROM workbench_approvals WHERE idempotency_key = ?')
      .get(idempotencyKey) as ApprovalRow | undefined;
    return row ? this.mapApproval(row) : null;
  }

  getApprovalByToolCall(runId: string, toolCallId: string): WorkbenchApproval | null {
    const row = this.db
      .prepare(
        `SELECT * FROM workbench_approvals
         WHERE run_id = ? AND tool_call_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(runId, toolCallId) as ApprovalRow | undefined;
    return row ? this.mapApproval(row) : null;
  }

  listApprovalsForRun(runId: string): WorkbenchApproval[] {
    const rows = this.db
      .prepare('SELECT * FROM workbench_approvals WHERE run_id = ? ORDER BY created_at')
      .all(runId) as ApprovalRow[];
    return rows.map(row => this.mapApproval(row));
  }

  listPendingApprovalsForRun(runId: string): WorkbenchApproval[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM workbench_approvals WHERE run_id = ? AND decision = ? ORDER BY created_at`,
      )
      .all(runId, WorkbenchApprovalDecision.Pending) as ApprovalRow[];
    return rows.map(row => this.mapApproval(row));
  }

  updateApproval(
    approvalId: string,
    patch: Partial<
      Pick<WorkbenchApproval, 'decision' | 'decisionSource' | 'effectStatus' | 'result'>
    >,
  ): WorkbenchApproval {
    const current = this.requireApproval(approvalId);
    const decision = patch.decision ?? current.decision;
    const decisionSource =
      patch.decisionSource === undefined ? current.decisionSource : patch.decisionSource;
    const effectStatus = patch.effectStatus ?? current.effectStatus;
    const result = patch.result === undefined ? current.result : patch.result;
    const now = Date.now();
    const decidedAt =
      current.decidedAt ?? (decision === WorkbenchApprovalDecision.Pending ? null : now);
    this.db
      .prepare(
        `UPDATE workbench_approvals
         SET decision = ?, decision_source = ?, effect_status = ?, result_json = ?,
             updated_at = ?, decided_at = ?
         WHERE id = ?`,
      )
      .run(
        decision,
        decisionSource,
        effectStatus,
        result ? JSON.stringify(result) : null,
        now,
        decidedAt,
        approvalId,
      );
    return this.requireApproval(approvalId);
  }

  markInterruptedToolEffectsForReview(runId: string): void {
    this.db
      .prepare(
        'UPDATE workbench_approvals SET effect_status = ?, updated_at = ? WHERE run_id = ? AND effect_status = ?',
      )
      .run(
        WorkbenchApprovalEffectStatus.NeedsReview,
        Date.now(),
        runId,
        WorkbenchApprovalEffectStatus.Executing,
      );
  }

  getDetail(taskId: string): WorkbenchTaskDetail | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    const runRows = (
      this.db
        .prepare('SELECT * FROM workbench_runs WHERE task_id = ? ORDER BY attempt DESC')
        .all(taskId) as RunRow[]
    ).filter(row => executionStatuses.has(row.status));
    const eventRows = this.db
      .prepare(
        `SELECT e.* FROM workbench_run_events e
         JOIN workbench_runs r ON r.id = e.run_id
         WHERE r.task_id = ? ORDER BY r.attempt DESC, e.sequence`,
      )
      .all(taskId) as EventRow[];
    const artifactRows = this.hasHistoricalArtifacts
      ? this.db
          .prepare<[string], ArtifactRow>(
            'SELECT * FROM workbench_artifacts WHERE task_id = ? ORDER BY created_at DESC',
          )
          .all(taskId)
      : [];
    const approvalRows = this.db
      .prepare('SELECT * FROM workbench_approvals WHERE task_id = ? ORDER BY created_at DESC')
      .all(taskId) as ApprovalRow[];
    const currentRuns = runRows.map(row => ({
      run: this.mapRun(row),
      terminalAfterSequence: row.terminal_after_sequence,
    }));
    const runIds = new Set(runRows.map(row => row.id));
    const eventsByRun = Map.groupBy(eventRows, row => row.run_id);
    return {
      task,
      runs: currentRuns.map(({ run }) => run),
      events: currentRuns.flatMap(({ run, terminalAfterSequence }) =>
        this.projectRunEvents(run, eventsByRun.get(run.id) ?? [], terminalAfterSequence),
      ),
      artifacts: artifactRows
        .filter(row => runIds.has(row.run_id))
        .map(row => this.mapArtifact(row)),
      approvals: approvalRows
        .filter(row => runIds.has(row.run_id))
        .map(row => this.mapApproval(row)),
    };
  }

  deleteSessionDomainData(
    sessionIds: readonly string[],
  ): Array<Pick<WorkbenchTask, 'id' | 'sessionId'>> {
    if (!sessionIds.length) return [];
    const ids = JSON.stringify(sessionIds);
    const selectedTasks =
      'SELECT id FROM workbench_tasks WHERE session_id IN (SELECT value FROM json_each(?))';
    return this.transaction(() => {
      const latest = this.db
        .prepare<[string], Pick<WorkbenchTask, 'id' | 'sessionId'>>(`
        SELECT ids.value AS sessionId, selected.id FROM json_each(?) ids
        JOIN workbench_tasks selected ON selected.id = (
          SELECT t.id ${TASK_WITH_CURRENT_RUN} AND t.session_id = ids.value ${LATEST_TASK_ORDER}
        )`)
        .all(ids);
      this.db
        .prepare(`DELETE FROM workbench_run_events WHERE run_id IN (
        SELECT id FROM workbench_runs WHERE task_id IN (${selectedTasks})
      )`)
        .run(ids);
      this.db
        .prepare(`DELETE FROM workbench_approvals WHERE task_id IN (${selectedTasks})`)
        .run(ids);
      if (this.hasHistoricalArtifacts) {
        this.db
          .prepare(`DELETE FROM workbench_artifacts WHERE task_id IN (${selectedTasks})`)
          .run(ids);
      }
      this.db.prepare(`DELETE FROM workbench_runs WHERE task_id IN (${selectedTasks})`).run(ids);
      this.db
        .prepare('DELETE FROM workbench_tasks WHERE session_id IN (SELECT value FROM json_each(?))')
        .run(ids);
      return latest;
    });
  }

  private requireRun(runId: string): WorkbenchRun {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Workbench run not found: ${runId}`);
    return run;
  }

  private requireApproval(approvalId: string): WorkbenchApproval {
    const approval = this.getApproval(approvalId);
    if (!approval) throw new Error(`Workbench approval not found: ${approvalId}`);
    return approval;
  }

  private mapTask(row: TaskRow): WorkbenchTask {
    return {
      id: row.id,
      sessionId: row.session_id,
      goal: row.goal,
      status: row.status,
      contract: parseJson<WorkbenchTaskContract>(row.contract_json, {
        kind: WorkbenchContractKind.GenericWork,
      }),
      activeRunId: row.active_run_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      endedAt: row.completed_at,
    };
  }

  private mapRun(row: RunRow): WorkbenchRun {
    return {
      id: row.id,
      taskId: row.task_id,
      attempt: row.attempt,
      status: row.status,
      trigger: row.trigger,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      context: parseJson<WorkbenchRunContext | null>(row.context_json, null),
      failure: parseJson<WorkbenchJsonObject | null>(row.failure_json, null),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private projectRunEvents(
    run: WorkbenchRun,
    rows: EventRow[],
    terminalAfterSequence: number | null,
  ): WorkbenchRunEvent[] {
    const events = rows.map(row => this.mapEvent(row, run));
    const project = (
      type: WorkbenchRunEvent['type'],
      createdAt: number,
      payload: WorkbenchJsonObject,
    ): WorkbenchRunEvent => ({
      id: `${run.id}:${type}`,
      runId: run.id,
      sequence: 0,
      type,
      createdAt,
      payload,
    });
    const created = events.find(event => event.type === WorkbenchRunEventType.RunCreated);
    const started = events.find(event => event.type === WorkbenchRunEventType.RunStarted);
    const terminalType = terminalRunEventTypes[run.status];
    const terminal =
      terminalType &&
      run.endedAt !== null &&
      terminalAfterSequence !== null &&
      !events.some(event => event.type === terminalType)
        ? project(
            terminalType,
            run.endedAt,
            terminalType === WorkbenchRunEventType.RunSettled ? {} : (run.failure ?? {}),
          )
        : null;
    if (!terminal && created && (started || run.startedAt === null)) return events;
    if (terminal && terminalAfterSequence !== null) {
      // Late observations can share the terminal timestamp, so use the recorded event boundary.
      const firstLateEvent = events.findIndex(event => event.sequence > terminalAfterSequence);
      events.splice(firstLateEvent === -1 ? events.length : firstLateEvent, 0, terminal);
    }
    const projected = [
      created ??
        project(WorkbenchRunEventType.RunCreated, run.createdAt, {
          trigger: run.trigger,
          attempt: run.attempt,
        }),
    ];
    if (run.startedAt !== null && !started) {
      projected.push(
        project(WorkbenchRunEventType.RunStarted, run.startedAt, { trigger: run.trigger }),
      );
    }
    projected.push(...events.filter(event => event !== created));
    return projected.map((event, index) => ({ ...event, sequence: index + 1 }));
  }

  private mapEvent(row: EventRow, run: WorkbenchRun): WorkbenchRunEvent {
    let payload = parseJson<WorkbenchJsonObject>(row.payload_json, {});
    if (row.payload_json === '{}') {
      switch (row.type) {
        case WorkbenchRunEventType.RunCreated:
          payload = { trigger: run.trigger, attempt: run.attempt };
          break;
        case WorkbenchRunEventType.RunStarted:
          payload = { trigger: run.trigger };
          break;
        case WorkbenchRunEventType.RunFailed:
        case WorkbenchRunEventType.RunCancelled:
          payload = run.failure ?? {};
          break;
      }
    }
    const profile = payload.profile;
    if (
      row.type === WorkbenchRunEventType.HarnessProfiled &&
      run.context &&
      profile &&
      typeof profile === 'object' &&
      !Array.isArray(profile) &&
      !('model' in profile)
    ) {
      payload.profile = {
        ...profile,
        ...normalizeHarnessModelFields(run.context),
      };
    }
    return {
      id: row.id,
      runId: row.run_id,
      sequence: row.sequence,
      type: row.type,
      payload,
      createdAt: row.created_at,
    };
  }

  private mapArtifact(row: ArtifactRow): WorkbenchArtifact {
    return {
      id: row.id,
      taskId: row.task_id,
      runId: row.run_id,
      kind: row.kind,
      mimeType: row.mime_type,
      reference: row.reference,
      contentHash: row.content_hash,
      provenance: row.provenance,
      verificationStatus: row.verification_status,
      metadata: parseJson<WorkbenchJsonObject>(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapApproval(row: ApprovalRow): WorkbenchApproval {
    return {
      id: row.id,
      taskId: row.task_id,
      runId: row.run_id,
      toolCallId: row.tool_call_id,
      toolName: row.tool_name,
      riskLevel: row.risk_level,
      decision: row.decision,
      decisionSource: row.decision_source,
      effectStatus: row.effect_status,
      idempotencyKey: row.idempotency_key,
      request: parseJson<WorkbenchJsonObject>(row.request_json, {}),
      result: parseJson<WorkbenchJsonObject | null>(row.result_json, null),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      decidedAt: row.decided_at,
    };
  }
}
