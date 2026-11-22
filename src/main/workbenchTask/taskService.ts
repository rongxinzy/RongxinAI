import type Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import { randomUUID } from 'node:crypto';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalDecisionSource,
  WorkbenchApprovalEffectStatus,
  WorkbenchContractKind,
  WorkbenchRunEventType,
  WorkbenchExecutionStatus,
  WorkbenchRunTrigger,
  type WorkbenchTerminalExecutionStatuses,
  type WorkbenchApproval,
  type WorkbenchApprovalRiskLevel,
  type WorkbenchJsonObject,
  type WorkbenchRun,
  type WorkbenchRunContext,
  type WorkbenchTask,
  type WorkbenchTaskChangedEvent,
  type WorkbenchTaskContract,
  type WorkbenchTaskDetail,
} from '../../shared/workbenchTask';
import { HarnessMeasurementService } from '../harness/measurementService';
import type { HarnessModelProfileInput } from '../../shared/harness';
import type { CoworkPersistedArtifact } from '../../shared/cowork/artifacts';
import type { SessionMemoryCompletion } from '../memory/sessionMemoryExtractor';
import { WorkbenchTaskRepository } from './repository';
import { observeWorkbench } from './observe';

interface SettledWorkbenchRunEvent {
  task: WorkbenchTask;
  run: WorkbenchRun;
  artifactScopeId: string;
  artifactsReady?: Promise<void>;
  onArtifactsReady?: (artifacts: CoworkPersistedArtifact[]) => Promise<void>;
  memoryCompletion?: SessionMemoryCompletion;
  approvals: WorkbenchTaskDetail['approvals'];
  workspaceRoot: string;
  finalAnswer: string;
}

export interface WorkbenchRunReservation {
  taskId: string;
  runId: string;
}

interface WorkbenchRunRequest {
  sessionId: string;
  goal: string;
  contract?: WorkbenchTaskContract;
  trigger?: WorkbenchRunTrigger;
  reservation?: WorkbenchRunReservation;
}

type RunProfile = Pick<HarnessModelProfileInput, 'workflowKind' | 'harnessVersion'>;

export interface WorkbenchTaskServiceOptions {
  onSettledRun?: (event: SettledWorkbenchRunEvent) => void;
}

const MAX_RESULT_DEPTH = 6;
const MAX_RESULT_NODES = 500;
const MAX_RESULT_COLLECTION_ENTRIES = 50;
const MAX_RESULT_STRING_LENGTH = 4_000;
const MAX_RESULT_SERIALIZED_LENGTH = 64_000;

const defaultContract = (): WorkbenchTaskContract => ({
  kind: WorkbenchContractKind.GenericWork,
});

/**
 * Passive read-only run/audit projection service backed by SQLite.
 *
 * Pi owns execution, retries, compaction, permissions, and terminal state;
 * this service only records run lifecycle, tool observations, and history
 * for the read-only Trace panel and companion status projection.
 */
export class WorkbenchTaskService extends EventEmitter {
  readonly repository: WorkbenchTaskRepository;
  readonly measurement: HarnessMeasurementService;

  constructor(
    db: Database.Database,
    private readonly options: WorkbenchTaskServiceOptions = {},
  ) {
    super();
    this.repository = new WorkbenchTaskRepository(db);
    this.measurement = new HarnessMeasurementService(this.repository);
  }

  getCurrent(sessionId: string): WorkbenchTaskDetail | null {
    const task = this.repository.getLatestTaskForSession(sessionId);
    return task ? this.repository.getDetail(task.id) : null;
  }

  getDetail(taskId: string): WorkbenchTaskDetail | null {
    return this.repository.getDetail(taskId);
  }

  listForSession(sessionId: string): WorkbenchTask[] {
    return this.repository.listTasksForSession(sessionId);
  }

  /** Assign a stable identity even if the audit must be retried on launch. */
  reserveRun(input: Omit<WorkbenchRunRequest, 'reservation'>): WorkbenchRunReservation {
    const reservation = { taskId: randomUUID(), runId: randomUUID() };
    observeWorkbench(input.sessionId, () =>
      this.repository.transaction(() => this.createQueuedRun({ ...input, reservation })),
    );
    return reservation;
  }

  beginRun(
    input: WorkbenchRunRequest,
    initial?: { context: WorkbenchRunContext; profile?: RunProfile },
  ): { task: WorkbenchTask; run: WorkbenchRun } {
    const supersededReason = 'Superseded by a new user message.';
    const result = this.repository.transaction(() => {
      let run = input.reservation ? this.repository.getRun(input.reservation.runId) : null;
      let task = run ? this.repository.getTask(run.taskId) : null;
      let supersededTask: WorkbenchTask | null = null;

      if (run) {
        if (!task) throw new Error('Prepared run task not found.');
        if (task.sessionId !== input.sessionId || task.id !== input.reservation?.taskId) {
          throw new Error('Prepared run does not belong to this task or session.');
        }
        if (
          !this.isRunActive(run.status) ||
          !this.isRunActive(task.status) ||
          task.activeRunId !== run.id
        ) {
          throw new Error('Prepared run is no longer active.');
        }
      } else {
        const activeTask = this.repository.getActiveTaskForSession(input.sessionId);
        if (activeTask?.activeRunId) {
          this.recordRunEnd(
            activeTask.activeRunId,
            WorkbenchExecutionStatus.Cancelled,
            supersededReason,
            {
              reason: supersededReason,
            },
          );
          supersededTask = this.requireTask(activeTask.id);
        }
        ({ task, run } = this.createQueuedRun(input));
      }

      if (run.status === WorkbenchExecutionStatus.Queued) {
        run = this.repository.updateRunStatus(run.id, WorkbenchExecutionStatus.Running);
      }
      if (initial) run = this.recordRunContext(run.id, initial.context, initial.profile);
      return { task: this.requireTask(task.id), run, supersededTask };
    });

    if (result.supersededTask) this.emitChanged(result.supersededTask);
    this.emitChanged(result.task);
    return { task: result.task, run: result.run };
  }

  updateRunContext(
    runId: string,
    context: WorkbenchRunContext,
    profile?: RunProfile,
  ): WorkbenchRun {
    const updated = this.repository.transaction(() =>
      this.recordRunContext(runId, context, profile),
    );
    this.emitChanged(this.requireTask(updated.taskId));
    return updated;
  }

  private recordRunContext(
    runId: string,
    context: WorkbenchRunContext,
    profile?: RunProfile,
  ): WorkbenchRun {
    const run = this.repository.updateRunContext(runId, context);
    if (profile) this.measurement.recordModelProfile(runId, { ...context, ...profile });
    return run;
  }

  settleObservedRun(input: {
    sessionId: string;
    runId: string;
    artifactScopeId?: string;
    artifactsReady?: Promise<void>;
    onArtifactsReady?: SettledWorkbenchRunEvent['onArtifactsReady'];
    memoryCompletion?: SessionMemoryCompletion;
    workspaceRoot?: string;
    finalAnswer?: string;
  }): void {
    const task = this.getActiveRunTask(input.sessionId, input.runId);
    if (!task) return;

    const settled = this.repository.transaction(() => {
      const run = this.recordRunEnd(
        input.runId,
        WorkbenchExecutionStatus.Settled,
        'Run completed.',
      );
      return { task: this.requireTask(task.id), run };
    });

    this.emitChanged(settled.task);
    if (!this.options.onSettledRun) return;
    try {
      this.options.onSettledRun({
        ...settled,
        artifactScopeId: input.artifactScopeId ?? input.sessionId,
        artifactsReady: input.artifactsReady,
        onArtifactsReady: input.onArtifactsReady,
        memoryCompletion: input.memoryCompletion,
        approvals: this.repository.listApprovalsForRun(settled.run.id).reverse(),
        workspaceRoot: input.workspaceRoot ?? settled.run.context?.workspaceRoot ?? '',
        finalAnswer: input.finalAnswer ?? '',
      });
    } catch (error) {
      console.warn(`[WorkbenchTask] settled callback failed for session ${task.sessionId}:`, error);
    }
  }

  failRun(sessionId: string, failure: WorkbenchJsonObject, runId: string): void {
    const task = this.getActiveRunTask(sessionId, runId);
    if (!task) return;
    const updatedTask = this.repository.transaction(() => {
      this.recordRunEnd(runId, WorkbenchExecutionStatus.Failed, 'Run failed.', failure);
      return this.requireTask(task.id);
    });
    this.emitChanged(updatedTask);
  }

  cancelRun(sessionId: string, runId?: string, reason = 'Run cancelled.'): void {
    const task =
      runId === undefined
        ? this.repository.getActiveTaskForSession(sessionId)
        : this.getActiveRunTask(sessionId, runId);
    const targetRunId = runId ?? task?.activeRunId;
    if (!task || !targetRunId) return;
    const updatedTask = this.repository.transaction(() => {
      this.recordRunEnd(targetRunId, WorkbenchExecutionStatus.Cancelled, reason, { reason });
      return this.requireTask(task.id);
    });
    this.emitChanged(updatedTask);
  }

  recordToolCallObserved(input: {
    runId: string | null;
    approvalId: string;
    toolCallId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    riskLevel: WorkbenchApprovalRiskLevel;
    idempotencyKey: string;
    autoApproved: boolean;
  }): void {
    if (!input.runId) return;
    const run = this.repository.getRun(input.runId);
    if (!run || !this.isRunActive(run.status)) return;
    const approval = this.repository.transaction(() => {
      const created = this.repository.createApproval({
        id: input.approvalId,
        taskId: run.taskId,
        runId: run.id,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        riskLevel: input.riskLevel,
        decision: input.autoApproved
          ? WorkbenchApprovalDecision.Approved
          : WorkbenchApprovalDecision.Pending,
        decisionSource: input.autoApproved ? WorkbenchApprovalDecisionSource.Policy : null,
        effectStatus: input.autoApproved
          ? WorkbenchApprovalEffectStatus.Executing
          : WorkbenchApprovalEffectStatus.NotStarted,
        idempotencyKey: `${input.approvalId}:${input.idempotencyKey}`,
        request: this.toJsonObject(input.toolInput),
      });
      this.repository.appendRunEvent(
        run.id,
        input.autoApproved
          ? WorkbenchRunEventType.ApprovalResolved
          : WorkbenchRunEventType.ApprovalRequested,
        {
          approvalId: created.id,
          toolName: input.toolName,
          riskLevel: input.riskLevel,
          ...(input.autoApproved ? { approved: true, auto: true } : {}),
        },
      );
      return created;
    });
    this.emitChanged(this.requireTask(approval.taskId));
  }

  recordToolApprovalDecision(input: {
    approvalId: string;
    decision: Exclude<WorkbenchApprovalDecision, typeof WorkbenchApprovalDecision.Pending>;
    reason?: string;
  }): void {
    const resolved = this.repository.transaction(() => {
      const approval = this.repository.getApproval(input.approvalId);
      return approval && this.resolvePendingApproval(approval, input.decision, input.reason)
        ? approval
        : null;
    });
    if (resolved) this.emitChanged(this.requireTask(resolved.taskId));
  }

  recordToolResult(runId: string, toolCallId: string, result: unknown, isError: boolean): void {
    const approval = this.repository.getApprovalByToolCall(runId, toolCallId);
    if (approval?.effectStatus !== WorkbenchApprovalEffectStatus.Executing) return;
    this.repository.transaction(() => {
      this.repository.updateApproval(approval.id, {
        effectStatus: isError
          ? WorkbenchApprovalEffectStatus.Failed
          : WorkbenchApprovalEffectStatus.Succeeded,
        result: this.toJsonObject(result),
      });
      this.repository.appendRunEvent(runId, WorkbenchRunEventType.ToolEffectFinished, {
        approvalId: approval.id,
        success: !isError,
      });
    });
    this.emitChanged(this.requireTask(approval.taskId));
  }

  recoverInterruptedRuns(closeTranscript?: (sessionId: string, startedAt: number) => void): number {
    const reason = 'application_restart';
    return this.repository.transaction(() => {
      const runs = this.repository.listInterruptedRuns();
      for (const { id, sessionId, startedAt } of runs) {
        if (startedAt !== null) closeTranscript?.(sessionId, startedAt);
        this.recordRunEnd(id, WorkbenchExecutionStatus.Cancelled, reason, { reason });
      }
      this.repository.cancelInterruptedTasksWithoutRuns();
      return runs.length;
    });
  }

  private createQueuedRun(input: WorkbenchRunRequest): { task: WorkbenchTask; run: WorkbenchRun } {
    const task = this.repository.createTask(
      input.sessionId,
      input.goal,
      input.contract ? { ...input.contract } : defaultContract(),
      input.reservation?.taskId,
    );
    const run = this.repository.createRun(
      task.id,
      input.trigger ?? WorkbenchRunTrigger.Message,
      input.reservation?.runId,
    );
    return { task, run };
  }

  private recordRunEnd(
    runId: string,
    status: (typeof WorkbenchTerminalExecutionStatuses)[number],
    reason: string,
    failure?: WorkbenchJsonObject,
  ): WorkbenchRun {
    for (const approval of this.repository.listPendingApprovalsForRun(runId)) {
      this.resolvePendingApproval(approval, WorkbenchApprovalDecision.Expired, reason);
    }
    this.repository.markInterruptedToolEffectsForReview(runId);
    return this.repository.updateRunStatus(runId, status, { failure });
  }

  private resolvePendingApproval(
    approval: WorkbenchApproval,
    decision: Exclude<WorkbenchApprovalDecision, typeof WorkbenchApprovalDecision.Pending>,
    reason?: string,
  ): boolean {
    if (approval.decision !== WorkbenchApprovalDecision.Pending) return false;
    const approved = decision === WorkbenchApprovalDecision.Approved;
    const expired = decision === WorkbenchApprovalDecision.Expired;
    this.repository.updateApproval(approval.id, {
      decision,
      decisionSource: expired
        ? WorkbenchApprovalDecisionSource.Recovery
        : WorkbenchApprovalDecisionSource.User,
      effectStatus: approved
        ? WorkbenchApprovalEffectStatus.Executing
        : WorkbenchApprovalEffectStatus.NotStarted,
      ...(reason ? { result: { reason } } : {}),
    });
    this.repository.appendRunEvent(approval.runId, WorkbenchRunEventType.ApprovalResolved, {
      approvalId: approval.id,
      approved,
      ...(expired ? { expired: true } : {}),
    });
    return true;
  }

  emitChanged(task: Pick<WorkbenchTask, 'id' | 'sessionId'>): void {
    const event: WorkbenchTaskChangedEvent = { sessionId: task.sessionId, taskId: task.id };
    this.emit('changed', event);
  }

  private requireTask(taskId: string): WorkbenchTask {
    const task = this.repository.getTask(taskId);
    if (!task) throw new Error(`Workbench task not found: ${taskId}`);
    return task;
  }

  private getActiveRunTask(sessionId: string, runId: string): WorkbenchTask | null {
    const run = this.repository.getRun(runId);
    if (!run || !this.isRunActive(run.status)) return null;
    const task = this.repository.getTask(run.taskId);
    return task?.sessionId === sessionId ? task : null;
  }

  private isRunActive(status: WorkbenchRun['status']): boolean {
    return (
      status === WorkbenchExecutionStatus.Queued || status === WorkbenchExecutionStatus.Running
    );
  }

  private toJsonObject(value: unknown): WorkbenchJsonObject {
    const seen = new WeakSet<object>();
    let remainingNodes = MAX_RESULT_NODES;
    const normalize = (candidate: unknown, depth: number): unknown => {
      if (candidate === null || typeof candidate === 'boolean') return candidate;
      if (typeof candidate === 'string') {
        return candidate.length <= MAX_RESULT_STRING_LENGTH
          ? candidate
          : `${candidate.slice(0, MAX_RESULT_STRING_LENGTH)}[Truncated]`;
      }
      if (typeof candidate === 'number') {
        return Number.isFinite(candidate) ? candidate : String(candidate);
      }
      if (typeof candidate === 'bigint') return candidate.toString();
      if (typeof candidate === 'undefined') return null;
      if (typeof candidate === 'function' || typeof candidate === 'symbol') {
        return String(candidate);
      }
      if (depth >= MAX_RESULT_DEPTH || remainingNodes <= 0) return '[Truncated]';
      if (typeof candidate === 'object') {
        if (seen.has(candidate)) return '[Circular]';
        seen.add(candidate);
        remainingNodes -= 1;
        if (candidate instanceof Error) {
          return { name: candidate.name, message: candidate.message };
        }
        if (Array.isArray(candidate)) {
          return candidate
            .slice(0, MAX_RESULT_COLLECTION_ENTRIES)
            .map(item => normalize(item, depth + 1));
        }
        const entries = Object.entries(candidate as Record<string, unknown>).slice(
          0,
          MAX_RESULT_COLLECTION_ENTRIES,
        );
        const normalized: Record<string, unknown> = {};
        for (const [key, item] of entries) {
          normalized[key] = normalize(item, depth + 1);
        }
        return normalized;
      }
      return String(candidate);
    };

    const result =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (normalize(value, 0) as WorkbenchJsonObject)
        : ({ value: normalize(value, 0) } as WorkbenchJsonObject);
    const serialized = JSON.stringify(result);
    if (serialized.length <= MAX_RESULT_SERIALIZED_LENGTH) return result;
    return { truncated: true, preview: serialized.slice(0, MAX_RESULT_STRING_LENGTH) };
  }
}
