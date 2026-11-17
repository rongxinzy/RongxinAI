import type Database from 'better-sqlite3';
import { EventEmitter } from 'events';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalDecisionSource,
  WorkbenchApprovalEffectStatus,
  WorkbenchArtifactKind,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
  WorkbenchRunEventType,
  WorkbenchExecutionStatus,
  WorkbenchRunTrigger,
  type WorkbenchApproval,
  type WorkbenchApprovalRiskLevel,
  type WorkbenchArtifact,
  type WorkbenchJsonObject,
  type WorkbenchRun,
  type WorkbenchRunContext,
  type WorkbenchTask,
  type WorkbenchTaskChangedEvent,
  type WorkbenchTaskContract,
  type WorkbenchTaskDetail,
} from '../../shared/workbenchTask';
import type { CoworkPersistedArtifact } from '../../shared/cowork/artifacts';
import { HarnessMeasurementService } from '../harness/measurementService';
import { WorkbenchTaskRepository } from './repository';

interface SettledWorkbenchRunEvent {
  task: WorkbenchTask;
  run: WorkbenchRun;
  artifacts: WorkbenchTaskDetail['artifacts'];
  approvals: WorkbenchTaskDetail['approvals'];
  workspaceRoot: string;
  finalAnswer: string;
}

export interface WorkbenchTaskServiceOptions {
  onSettledRun?: (event: SettledWorkbenchRunEvent) => void;
  /** Reads the event-time artifact ledger for one scope (session or lane). */
  listLedgerArtifacts?: (scopeId: string) => CoworkPersistedArtifact[];
}

const MAX_RESULT_DEPTH = 6;
const MAX_RESULT_NODES = 500;
const MAX_RESULT_COLLECTION_ENTRIES = 50;
const MAX_RESULT_STRING_LENGTH = 4_000;
const MAX_RESULT_SERIALIZED_LENGTH = 64_000;

const defaultContract = (): WorkbenchTaskContract => ({
  kind: WorkbenchContractKind.GenericWork,
});

function toReadOnlyArtifactProjection(
  taskId: string,
  runId: string,
  artifact: CoworkPersistedArtifact,
): WorkbenchArtifact {
  return {
    id: artifact.id,
    taskId,
    runId,
    kind: WorkbenchArtifactKind.File,
    mimeType: 'application/octet-stream',
    reference: artifact.filePath || artifact.title,
    contentHash: '',
    provenance: WorkbenchArtifactProvenance.Workspace,
    verificationStatus: WorkbenchArtifactVerificationStatus.Pending,
    metadata: { title: artifact.title, source: artifact.source, role: artifact.role },
    createdAt: artifact.createdAt,
    updatedAt: artifact.createdAt,
  };
}

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

  beginRun(input: {
    sessionId: string;
    goal: string;
    contract?: WorkbenchTaskContract;
    trigger?: WorkbenchRunTrigger;
    preparedRunId?: string;
    preparedTaskId?: string;
  }): { task: WorkbenchTask; run: WorkbenchRun } {
    const supersededReason = 'Superseded by a new user message.';
    const result = this.repository.transaction(() => {
      let run = input.preparedRunId ? this.repository.getRun(input.preparedRunId) : null;
      let task = run ? this.repository.getTask(run.taskId) : null;
      let supersededTask: WorkbenchTask | null = null;

      if (run) {
        if (!task) throw new Error('Prepared run task not found.');
        if (task.sessionId !== input.sessionId) {
          throw new Error('Prepared run does not belong to this session.');
        }
      } else {
        const activeTask = this.repository.getActiveTaskForSession(input.sessionId);
        if (activeTask) {
          this.expirePendingApprovalsForSession(input.sessionId, supersededReason);
          if (activeTask.activeRunId) {
            const activeRun = this.repository.getRun(activeTask.activeRunId);
            if (activeRun && this.isRunActive(activeRun.status)) {
              this.repository.updateRunStatus(activeRun.id, WorkbenchExecutionStatus.Cancelled, {
                failure: { reason: supersededReason },
              });
              this.repository.appendRunEvent(activeRun.id, WorkbenchRunEventType.RunCancelled, {
                reason: supersededReason,
              });
            }
          }
          supersededTask = this.repository.updateTaskStatus(
            activeTask.id,
            WorkbenchExecutionStatus.Cancelled,
            null,
          );
        }
        task = this.repository.createTask(
          input.sessionId,
          input.goal,
          input.contract ? { ...input.contract } : defaultContract(),
          input.preparedTaskId,
        );
        run = this.repository.createRun(
          task.id,
          input.trigger ?? WorkbenchRunTrigger.Message,
          input.preparedRunId,
        );
        this.repository.updateTaskStatus(task.id, WorkbenchExecutionStatus.Queued, run.id);
      }

      if (run.status === WorkbenchExecutionStatus.Queued) {
        run = this.repository.updateRunStatus(run.id, WorkbenchExecutionStatus.Running);
        this.repository.appendRunEvent(run.id, WorkbenchRunEventType.RunStarted, {
          trigger: run.trigger,
        });
      }
      task = this.repository.updateTaskStatus(task.id, WorkbenchExecutionStatus.Running, run.id);
      return { task, run, supersededTask };
    });

    if (result.supersededTask) this.emitChanged(result.supersededTask);
    this.emitChanged(result.task);
    return { task: result.task, run: result.run };
  }

  updateRunContext(runId: string, context: WorkbenchRunContext): WorkbenchRun {
    const updated = this.repository.updateRunContext(runId, context);
    this.emitChanged(this.requireTask(updated.taskId));
    return updated;
  }

  settleObservedRun(input: {
    sessionId: string;
    runId: string;
    artifactScopeId?: string;
    workspaceRoot?: string;
    finalAnswer?: string;
  }): WorkbenchTaskDetail | null {
    const existing = this.repository.getRun(input.runId);
    if (!existing) return null;
    const task = this.repository.getTask(existing.taskId);
    if (!task || task.sessionId !== input.sessionId) return null;
    if (!this.isRunActive(existing.status)) return this.repository.getDetail(task.id);

    this.repository.transaction(() => {
      if (input.finalAnswer !== undefined) {
        this.repository.updateFinalAnswer(existing.id, input.finalAnswer);
      }
      this.expirePendingApprovalsForRun(existing.id, 'Run completed.');
      this.repository.updateRunStatus(existing.id, WorkbenchExecutionStatus.Settled);
      this.repository.appendRunEvent(existing.id, WorkbenchRunEventType.RunSettled, {});
      this.repository.updateTaskStatus(task.id, WorkbenchExecutionStatus.Settled, null);
    });

    const detail = this.repository.getDetail(task.id);
    if (detail) {
      this.emitChanged(detail.task);
      const settledRun = detail.runs.find(run => run.id === existing.id) ?? detail.runs[0];
      if (settledRun && this.options.onSettledRun) {
        const ledgerScope = input.artifactScopeId ?? input.sessionId;
        const ledgerArtifacts =
          this.options
            .listLedgerArtifacts?.(ledgerScope)
            .map(artifact =>
              toReadOnlyArtifactProjection(detail.task.id, settledRun.id, artifact),
            ) ?? [];
        const artifacts = detail.artifacts.length > 0 ? detail.artifacts : ledgerArtifacts;
        try {
          this.options.onSettledRun({
            task: detail.task,
            run: settledRun,
            artifacts,
            approvals: detail.approvals,
            workspaceRoot: input.workspaceRoot ?? settledRun.context?.workspaceRoot ?? '',
            finalAnswer: input.finalAnswer ?? '',
          });
        } catch (error) {
          console.warn(
            `[WorkbenchTask] settled callback failed for session ${task.sessionId}:`,
            error,
          );
        }
      }
    }
    return detail;
  }

  failRun(sessionId: string, failure: WorkbenchJsonObject): void {
    const task = this.repository.getActiveTaskForSession(sessionId);
    if (!task) return;
    const updatedTask = this.repository.transaction(() => {
      this.expirePendingApprovalsForSession(sessionId, 'Run failed.');
      if (task.activeRunId) {
        const run = this.repository.getRun(task.activeRunId);
        if (run && this.isRunActive(run.status)) {
          this.repository.updateRunStatus(run.id, WorkbenchExecutionStatus.Failed, { failure });
          this.repository.appendRunEvent(run.id, WorkbenchRunEventType.RunFailed, failure);
        }
      }
      return this.repository.updateTaskStatus(task.id, WorkbenchExecutionStatus.Failed, null);
    });
    this.emitChanged(updatedTask);
  }

  cancelRun(sessionId: string, runId?: string | null, reason = 'Run cancelled.'): void {
    const task = this.repository.getActiveTaskForSession(sessionId);
    if (!task) return;
    const targetRunId = runId ?? task.activeRunId;
    if (!targetRunId || (runId && task.activeRunId && task.activeRunId !== runId)) return;
    const updatedTask = this.repository.transaction(() => {
      this.expirePendingApprovalsForSession(sessionId, reason);
      const run = targetRunId ? this.repository.getRun(targetRunId) : null;
      if (run && this.isRunActive(run.status)) {
        this.repository.updateRunStatus(run.id, WorkbenchExecutionStatus.Cancelled, {
          failure: { reason },
        });
        this.repository.appendRunEvent(run.id, WorkbenchRunEventType.RunCancelled, { reason });
      }
      return this.repository.updateTaskStatus(task.id, WorkbenchExecutionStatus.Cancelled, null);
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
    runId: string | null;
    decision: WorkbenchApprovalDecision;
    reason?: string;
  }): void {
    const approval = this.repository.getApproval(input.approvalId);
    if (!approval) return;
    const approved = input.decision === WorkbenchApprovalDecision.Approved;
    const expired = input.decision === WorkbenchApprovalDecision.Expired;
    this.repository.transaction(() => {
      this.repository.updateApproval(approval.id, {
        decision: input.decision,
        decisionSource: expired
          ? WorkbenchApprovalDecisionSource.Recovery
          : WorkbenchApprovalDecisionSource.User,
        effectStatus: approved
          ? WorkbenchApprovalEffectStatus.Executing
          : WorkbenchApprovalEffectStatus.NotStarted,
        ...(input.reason ? { result: { reason: input.reason } } : {}),
      });
      this.repository.appendRunEvent(approval.runId, WorkbenchRunEventType.ApprovalResolved, {
        approvalId: approval.id,
        approved,
        ...(expired ? { expired: true } : {}),
      });
    });
    this.emitChanged(this.requireTask(approval.taskId));
  }

  recordToolResult(runId: string, toolCallId: string, result: unknown, isError: boolean): void {
    const approval = this.repository.getApprovalByToolCall(runId, toolCallId);
    if (!approval) return;
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

  deleteSession(sessionId: string): void {
    this.repository.transaction(() => {
      this.repository.deleteSessionDomainData(sessionId);
    });
  }

  private expirePendingApprovalsForSession(sessionId: string, reason: string): void {
    const approvals = this.repository.listPendingApprovalsForSession(sessionId);
    for (const approval of approvals) {
      this.repository.updateApproval(approval.id, {
        decision: WorkbenchApprovalDecision.Expired,
        decisionSource: WorkbenchApprovalDecisionSource.Recovery,
        result: { reason },
      });
      this.repository.appendRunEvent(approval.runId, WorkbenchRunEventType.ApprovalResolved, {
        approvalId: approval.id,
        approved: false,
        expired: true,
      });
    }
  }

  private expirePendingApprovalsForRun(runId: string, reason: string): void {
    const approvals = this.repository.listApprovalsForRun(runId);
    for (const approval of approvals) {
      if (approval.decision !== WorkbenchApprovalDecision.Pending) continue;
      this.repository.updateApproval(approval.id, {
        decision: WorkbenchApprovalDecision.Expired,
        decisionSource: WorkbenchApprovalDecisionSource.Recovery,
        result: { reason },
      });
      this.repository.appendRunEvent(runId, WorkbenchRunEventType.ApprovalResolved, {
        approvalId: approval.id,
        approved: false,
        expired: true,
      });
    }
  }

  private emitChanged(task: WorkbenchTask): void {
    const event: WorkbenchTaskChangedEvent = { sessionId: task.sessionId, taskId: task.id };
    this.emit('changed', event);
  }

  private requireTask(taskId: string): WorkbenchTask {
    const task = this.repository.getTask(taskId);
    if (!task) throw new Error(`Workbench task not found: ${taskId}`);
    return task;
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
