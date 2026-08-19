import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalEffectStatus,
  WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
  WorkbenchRunEventType,
  WorkbenchRunStatus,
  WorkbenchTaskStatus,
  WorkbenchTerminalTaskStatuses,
  type WorkbenchApproval,
  type WorkbenchApprovalDecisionSource,
  type WorkbenchApprovalRiskLevel,
  type WorkbenchArtifact,
  type WorkbenchArtifactKind,
  type WorkbenchArtifactProvenance,
  type WorkbenchJsonObject,
  type WorkbenchRun,
  type WorkbenchRunContext,
  type WorkbenchRunEvent,
  type WorkbenchRunStatus as WorkbenchRunStatusType,
  type WorkbenchRunTrigger,
  type WorkbenchTask,
  type WorkbenchTaskContract,
  type WorkbenchTaskDetail,
  type WorkbenchTaskStatus as WorkbenchTaskStatusType,
  type WorkbenchVerificationResult,
} from '../../shared/workbenchTask';
import { assertRunTransition, assertTaskTransition } from './stateMachine';

const terminalTaskStatuses = new Set<string>(WorkbenchTerminalTaskStatuses);

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
  status: WorkbenchTaskStatusType;
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
  status: WorkbenchRunStatusType;
  trigger: WorkbenchRunTrigger;
  started_at: number | null;
  ended_at: number | null;
  context_json: string | null;
  verification_result_json: string | null;
  failure_json: string | null;
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
  constructor(private readonly db: Database.Database) {}

  transaction<T>(operation: () => T): T {
    return this.db.transaction(operation)();
  }

  createTask(sessionId: string, goal: string, contract: WorkbenchTaskContract): WorkbenchTask {
    const now = Date.now();
    const task: WorkbenchTask = {
      id: randomUUID(),
      sessionId,
      goal,
      status: WorkbenchTaskStatus.Planned,
      contract,
      activeRunId: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
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
        task.completedAt,
      );
    return task;
  }

  getTask(taskId: string): WorkbenchTask | null {
    const row = this.db.prepare('SELECT * FROM workbench_tasks WHERE id = ?').get(taskId) as
      | TaskRow
      | undefined;
    return row ? this.mapTask(row) : null;
  }

  getLatestTaskForSession(sessionId: string): WorkbenchTask | null {
    const row = this.db
      .prepare(
        'SELECT * FROM workbench_tasks WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(sessionId) as TaskRow | undefined;
    return row ? this.mapTask(row) : null;
  }

  listTasksForSession(sessionId: string): WorkbenchTask[] {
    const rows = this.db
      .prepare('SELECT * FROM workbench_tasks WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId) as TaskRow[];
    return rows.map(row => this.mapTask(row));
  }

  getActiveTaskForSession(sessionId: string): WorkbenchTask | null {
    const rows = this.db
      .prepare('SELECT * FROM workbench_tasks WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId) as TaskRow[];
    const row = rows.find(candidate => !terminalTaskStatuses.has(candidate.status));
    return row ? this.mapTask(row) : null;
  }

  updateTaskStatus(
    taskId: string,
    status: WorkbenchTaskStatusType,
    activeRunId?: string | null,
  ): WorkbenchTask {
    const current = this.requireTask(taskId);
    assertTaskTransition(current.status, status);
    const now = Date.now();
    const completedAt =
      status === WorkbenchTaskStatus.Completed
        ? now
        : status === WorkbenchTaskStatus.Running
          ? null
          : current.completedAt;
    const nextActiveRunId = activeRunId === undefined ? current.activeRunId : activeRunId;
    this.db
      .prepare(
        `UPDATE workbench_tasks
         SET status = ?, active_run_id = ?, updated_at = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(status, nextActiveRunId, now, completedAt, taskId);
    return this.requireTask(taskId);
  }

  createRun(taskId: string, trigger: WorkbenchRunTrigger): WorkbenchRun {
    const now = Date.now();
    const attemptRow = this.db
      .prepare(
        'SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt FROM workbench_runs WHERE task_id = ?',
      )
      .get(taskId) as { attempt: number };
    const run: WorkbenchRun = {
      id: randomUUID(),
      taskId,
      attempt: attemptRow.attempt,
      status: WorkbenchRunStatus.Queued,
      trigger,
      startedAt: null,
      endedAt: null,
      context: null,
      verificationResult: null,
      failure: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO workbench_runs
         (id, task_id, attempt, status, trigger, started_at, ended_at,
          context_json, verification_result_json, failure_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        null,
        now,
        now,
      );
    this.appendRunEvent(run.id, WorkbenchRunEventType.RunCreated, {
      trigger,
      attempt: run.attempt,
    });
    return run;
  }

  getRun(runId: string): WorkbenchRun | null {
    const row = this.db.prepare('SELECT * FROM workbench_runs WHERE id = ?').get(runId) as
      | RunRow
      | undefined;
    return row ? this.mapRun(row) : null;
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
    status: WorkbenchRunStatusType,
    options: {
      verificationResult?: WorkbenchVerificationResult | null;
      failure?: WorkbenchJsonObject | null;
    } = {},
  ): WorkbenchRun {
    const current = this.requireRun(runId);
    assertRunTransition(current.status, status);
    const now = Date.now();
    const startedAt =
      status === WorkbenchRunStatus.Running && current.startedAt === null ? now : current.startedAt;
    const terminalStatuses = new Set<WorkbenchRunStatusType>([
      WorkbenchRunStatus.Succeeded,
      WorkbenchRunStatus.Failed,
      WorkbenchRunStatus.Cancelled,
      WorkbenchRunStatus.Paused,
      WorkbenchRunStatus.NeedsReview,
    ]);
    const endedAt = terminalStatuses.has(status) ? now : current.endedAt;
    const verification =
      options.verificationResult === undefined
        ? current.verificationResult
        : options.verificationResult;
    const failure = options.failure === undefined ? current.failure : options.failure;
    this.db
      .prepare(
        `UPDATE workbench_runs
         SET status = ?, started_at = ?, ended_at = ?, verification_result_json = ?,
             failure_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        status,
        startedAt,
        endedAt,
        verification ? JSON.stringify(verification) : null,
        failure ? JSON.stringify(failure) : null,
        now,
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

  addArtifact(input: Omit<WorkbenchArtifact, 'id' | 'createdAt' | 'updatedAt'>): WorkbenchArtifact {
    const existing = this.db
      .prepare(
        `SELECT * FROM workbench_artifacts
         WHERE run_id = ? AND reference = ? AND content_hash = ?`,
      )
      .get(input.runId, input.reference, input.contentHash) as ArtifactRow | undefined;
    if (existing) {
      const current = this.mapArtifact(existing);
      const replaceEvidence =
        input.verificationStatus !== WorkbenchArtifactVerificationStatus.Pending ||
        current.verificationStatus === WorkbenchArtifactVerificationStatus.Pending;
      const updatedAt = Date.now();
      this.db
        .prepare(
          `UPDATE workbench_artifacts
           SET provenance = ?, verification_status = ?, metadata_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          replaceEvidence ? input.provenance : current.provenance,
          replaceEvidence ? input.verificationStatus : current.verificationStatus,
          JSON.stringify({ ...current.metadata, ...input.metadata }),
          updatedAt,
          current.id,
        );
      return this.mapArtifact(
        this.db
          .prepare('SELECT * FROM workbench_artifacts WHERE id = ?')
          .get(current.id) as ArtifactRow,
      );
    }
    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO workbench_artifacts
         (id, task_id, run_id, kind, mime_type, reference, content_hash, provenance,
          verification_status, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.taskId,
        input.runId,
        input.kind,
        input.mimeType,
        input.reference,
        input.contentHash,
        input.provenance,
        input.verificationStatus,
        JSON.stringify(input.metadata),
        now,
        now,
      );
    return this.mapArtifact(
      this.db.prepare('SELECT * FROM workbench_artifacts WHERE id = ?').get(id) as ArtifactRow,
    );
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
    >,
  ): WorkbenchApproval {
    const existing = this.getApprovalByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const now = Date.now();
    const id = randomUUID();
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

  listPendingApprovalsForSession(sessionId: string): WorkbenchApproval[] {
    const rows = this.db
      .prepare(
        `SELECT a.* FROM workbench_approvals a
         JOIN workbench_tasks t ON t.id = a.task_id
         WHERE t.session_id = ? AND a.decision = ?
         ORDER BY a.created_at`,
      )
      .all(sessionId, WorkbenchApprovalDecision.Pending) as ApprovalRow[];
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

  listRecoverableRuns(): WorkbenchRun[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM workbench_runs
         WHERE status IN (?, ?, ?)
         ORDER BY updated_at`,
      )
      .all(
        WorkbenchRunStatus.Running,
        WorkbenchRunStatus.Verifying,
        WorkbenchRunStatus.WaitingApproval,
      ) as RunRow[];
    return rows.map(row => this.mapRun(row));
  }

  listExecutingApprovals(): WorkbenchApproval[] {
    const rows = this.db
      .prepare('SELECT * FROM workbench_approvals WHERE effect_status = ?')
      .all(WorkbenchApprovalEffectStatus.Executing) as ApprovalRow[];
    return rows.map(row => this.mapApproval(row));
  }

  getDetail(taskId: string): WorkbenchTaskDetail | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    const runRows = this.db
      .prepare('SELECT * FROM workbench_runs WHERE task_id = ? ORDER BY attempt DESC')
      .all(taskId) as RunRow[];
    const eventRows = this.db
      .prepare(
        `SELECT e.* FROM workbench_run_events e
         JOIN workbench_runs r ON r.id = e.run_id
         WHERE r.task_id = ? ORDER BY r.attempt DESC, e.sequence`,
      )
      .all(taskId) as EventRow[];
    const artifactRows = this.db
      .prepare('SELECT * FROM workbench_artifacts WHERE task_id = ? ORDER BY created_at DESC')
      .all(taskId) as ArtifactRow[];
    const approvalRows = this.db
      .prepare('SELECT * FROM workbench_approvals WHERE task_id = ? ORDER BY created_at DESC')
      .all(taskId) as ApprovalRow[];
    return {
      task,
      runs: runRows.map(row => this.mapRun(row)),
      events: eventRows.map(row => this.mapEvent(row)),
      artifacts: artifactRows.map(row => this.mapArtifact(row)),
      approvals: approvalRows.map(row => this.mapApproval(row)),
    };
  }

  deleteSessionDomainData(sessionId: string): void {
    this.transaction(() => {
      const taskIds = (
        this.db
          .prepare('SELECT id FROM workbench_tasks WHERE session_id = ?')
          .all(sessionId) as Array<{ id: string }>
      ).map(row => row.id);
      for (const taskId of taskIds) {
        const runIds = (
          this.db.prepare('SELECT id FROM workbench_runs WHERE task_id = ?').all(taskId) as Array<{
            id: string;
          }>
        ).map(row => row.id);
        for (const runId of runIds) {
          this.db.prepare('DELETE FROM workbench_run_events WHERE run_id = ?').run(runId);
        }
        this.db.prepare('DELETE FROM workbench_approvals WHERE task_id = ?').run(taskId);
        this.db.prepare('DELETE FROM workbench_artifacts WHERE task_id = ?').run(taskId);
        this.db.prepare('DELETE FROM workbench_runs WHERE task_id = ?').run(taskId);
      }
      this.db.prepare('DELETE FROM workbench_tasks WHERE session_id = ?').run(sessionId);
    });
  }

  private requireTask(taskId: string): WorkbenchTask {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Workbench task not found: ${taskId}`);
    return task;
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
        requiresUserAcceptance: true,
      }),
      activeRunId: row.active_run_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
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
      verificationResult: parseJson<WorkbenchVerificationResult | null>(
        row.verification_result_json,
        null,
      ),
      failure: parseJson<WorkbenchJsonObject | null>(row.failure_json, null),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapEvent(row: EventRow): WorkbenchRunEvent {
    return {
      id: row.id,
      runId: row.run_id,
      sequence: row.sequence,
      type: row.type,
      payload: parseJson<WorkbenchJsonObject>(row.payload_json, {}),
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
