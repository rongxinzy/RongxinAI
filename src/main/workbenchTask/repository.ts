import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalEffectStatus,
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactKind,
  WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
  WorkbenchRunEventType,
  WorkbenchExecutionStatus,
  WorkbenchTerminalExecutionStatuses,
  isWorkbenchDeliverable,
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
const executionStatuses = new Set<string>(Object.values(WorkbenchExecutionStatus));

const artifactSourcePriority: Record<string, number> = {
  [WorkbenchArtifactCandidateSource.ToolEffect]: 1,
  [WorkbenchArtifactCandidateSource.DomainWorkflow]: 2,
  [WorkbenchArtifactCandidateSource.Declaration]: 3,
};

const getArtifactSourcePriority = (source: unknown): number =>
  typeof source === 'string' ? (artifactSourcePriority[source] ?? 0) : 0;

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
    const row = this.db.prepare('SELECT * FROM workbench_tasks WHERE id = ?').get(taskId) as
      | TaskRow
      | undefined;
    return row && executionStatuses.has(row.status) ? this.mapTask(row) : null;
  }

  getLatestTaskForSession(sessionId: string): WorkbenchTask | null {
    const row = this.db
      .prepare(
        'SELECT * FROM workbench_tasks WHERE session_id = ? AND status IN (?, ?, ?, ?, ?) ORDER BY created_at DESC LIMIT 1',
      )
      .get(sessionId, ...executionStatuses) as TaskRow | undefined;
    return row ? this.mapTask(row) : null;
  }

  listTasksForSession(sessionId: string): WorkbenchTask[] {
    const rows = this.db
      .prepare('SELECT * FROM workbench_tasks WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId) as TaskRow[];
    return rows.filter(row => executionStatuses.has(row.status)).map(row => this.mapTask(row));
  }

  getActiveTaskForSession(sessionId: string): WorkbenchTask | null {
    const rows = this.db
      .prepare('SELECT * FROM workbench_tasks WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId) as TaskRow[];
    const row = rows.find(
      candidate =>
        candidate.status === WorkbenchExecutionStatus.Queued ||
        candidate.status === WorkbenchExecutionStatus.Running,
    );
    return row ? this.mapTask(row) : null;
  }

  updateTaskStatus(
    taskId: string,
    status: WorkbenchExecutionStatusType,
    activeRunId?: string | null,
  ): WorkbenchTask {
    const current = this.requireTask(taskId);
    const now = Date.now();
    const endedAt = terminalTaskStatuses.has(status)
      ? now
      : status === WorkbenchExecutionStatus.Running
        ? null
        : current.endedAt;
    const nextActiveRunId = activeRunId === undefined ? current.activeRunId : activeRunId;
    this.db
      .prepare(
        `UPDATE workbench_tasks
         SET status = ?, active_run_id = ?, updated_at = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(status, nextActiveRunId, now, endedAt, taskId);
    return this.requireTask(taskId);
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
    return row && executionStatuses.has(row.status) ? this.mapRun(row) : null;
  }

  updateRunContext(runId: string, context: WorkbenchRunContext): WorkbenchRun {
    this.requireRun(runId);
    this.db
      .prepare('UPDATE workbench_runs SET context_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(context), Date.now(), runId);
    return this.requireRun(runId);
  }

  /**
   * Keep the observed final answer as provenance for reviewable memory candidates.
   * Native settlement alone does not verify the answer's business claims.
   */
  updateFinalAnswer(runId: string, finalAnswer: string): WorkbenchRun {
    this.requireRun(runId);
    this.db
      .prepare('UPDATE workbench_runs SET final_answer_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(finalAnswer), Date.now(), runId);
    return this.requireRun(runId);
  }

  getRunFinalAnswer(runId: string): string {
    const row = this.db
      .prepare('SELECT final_answer_json FROM workbench_runs WHERE id = ?')
      .get(runId) as { final_answer_json: string | null } | undefined;
    if (!row || !row.final_answer_json) return '';
    try {
      const parsed = JSON.parse(row.final_answer_json);
      return typeof parsed === 'string' ? parsed : '';
    } catch {
      return '';
    }
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
    const endedAt = terminalTaskStatuses.has(status) ? now : current.endedAt;
    const failure = options.failure === undefined ? current.failure : options.failure;
    this.db
      .prepare(
        `UPDATE workbench_runs
         SET status = ?, started_at = ?, ended_at = ?, failure_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, startedAt, endedAt, failure ? JSON.stringify(failure) : null, now, runId);
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
      const replaceIdentity =
        getArtifactSourcePriority(input.metadata.source) >=
        getArtifactSourcePriority(current.metadata.source);
      const replaceEvidence =
        input.verificationStatus !== WorkbenchArtifactVerificationStatus.Pending ||
        (current.verificationStatus === WorkbenchArtifactVerificationStatus.Pending &&
          replaceIdentity);
      const mergedMetadata = replaceIdentity
        ? { ...current.metadata, ...input.metadata }
        : { ...input.metadata, ...current.metadata };
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
          JSON.stringify(mergedMetadata),
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

  /**
   * Promote pending final deliverables only. Intermediate evidence, verified
   * artifacts and failed artifacts are left untouched.
   */
  markArtifactsVerified(runId: string, artifacts: WorkbenchArtifact[]): number {
    return this.transaction(() => {
      const update = this.db.prepare(
        'UPDATE workbench_artifacts SET verification_status = ?, updated_at = ? WHERE id = ? AND verification_status = ?',
      );
      let changes = 0;
      for (const artifact of artifacts) {
        if (artifact.runId !== runId || !isWorkbenchDeliverable(artifact)) continue;
        changes += update.run(
          WorkbenchArtifactVerificationStatus.Verified,
          Date.now(),
          artifact.id,
          WorkbenchArtifactVerificationStatus.Pending,
        ).changes;
      }
      return changes;
    });
  }

  countPendingArtifacts(runId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM workbench_artifacts
         WHERE run_id = ? AND verification_status = ?`,
      )
      .get(runId, WorkbenchArtifactVerificationStatus.Pending) as { n: number };
    return row.n;
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
      .all(WorkbenchExecutionStatus.Running) as RunRow[];
    return rows.filter(row => executionStatuses.has(row.status)).map(row => this.mapRun(row));
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
    const currentRuns = runRows.filter(row => executionStatuses.has(row.status));
    const currentRunIds = new Set(currentRuns.map(row => row.id));
    return {
      task,
      runs: currentRuns.map(row => this.mapRun(row)),
      events: eventRows.filter(row => currentRunIds.has(row.run_id)).map(row => this.mapEvent(row)),
      artifacts: artifactRows
        .filter(row => currentRunIds.has(row.run_id))
        .map(row => this.mapArtifact(row)),
      approvals: approvalRows
        .filter(row => currentRunIds.has(row.run_id))
        .map(row => this.mapApproval(row)),
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
