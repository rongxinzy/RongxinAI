import type Database from 'better-sqlite3';
import { EventEmitter } from 'events';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalDecisionSource,
  WorkbenchApprovalEffectStatus,
  WorkbenchApprovalRiskLevel,
  WorkbenchRunEventType,
  WorkbenchRunStatus,
  WorkbenchRunTrigger,
  WorkbenchTaskStatus,
  WorkbenchVerificationCheckStatus,
  WorkbenchVerificationOutcome,
  type WorkbenchApproval,
  type WorkbenchApprovalResponseInput,
  type WorkbenchJsonObject,
  type WorkbenchRun,
  type WorkbenchTask,
  type WorkbenchTaskChangedEvent,
  type WorkbenchTaskContract,
  type WorkbenchTaskDetail,
  type WorkbenchVerificationResult,
} from '../../shared/workbenchTask';
import { HarnessActivationType } from '../../shared/harness';
import { ProductionLoopRecoveryReason } from '../../shared/productionLoop';
import { HarnessMeasurementService } from '../harness/measurementService';
import { ProductionLoopRepository } from '../productionLoop/repository';
import { ProductionLoopService } from '../productionLoop/service';
import { collectWorkbenchArtifacts } from './artifactCollector';
import { WorkbenchTaskRepository } from './repository';
import { classifyWorkbenchToolRisk, createToolIdempotencyKey } from './riskClassifier';
import { verifyWorkbenchRun, type WorkbenchVerificationContext } from './verification';

export interface WorkbenchApprovalRequestedEvent {
  sessionId: string;
  approval: WorkbenchApproval;
}

export interface WorkbenchToolAuthorizationResult {
  allow: boolean;
  reason?: string;
}

type PendingApproval = {
  resolve: (result: WorkbenchToolAuthorizationResult) => void;
};

const MAX_RESULT_DEPTH = 6;
const MAX_RESULT_NODES = 500;
const MAX_RESULT_COLLECTION_ENTRIES = 50;
const MAX_RESULT_STRING_LENGTH = 4_000;
const MAX_RESULT_SERIALIZED_LENGTH = 64_000;

export class WorkbenchTaskService extends EventEmitter {
  readonly repository: WorkbenchTaskRepository;
  readonly measurement: HarnessMeasurementService;
  readonly productionLoop: ProductionLoopService;
  private readonly pendingApprovals = new Map<string, PendingApproval>();

  constructor(db: Database.Database) {
    super();
    this.repository = new WorkbenchTaskRepository(db);
    this.measurement = new HarnessMeasurementService(this.repository);
    this.productionLoop = new ProductionLoopService(
      new ProductionLoopRepository(db),
      this.measurement,
    );
  }

  getCurrent(sessionId: string): WorkbenchTaskDetail | null {
    const task = this.repository.getLatestTaskForSession(sessionId);
    return task ? this.repository.getDetail(task.id) : null;
  }

  getDetail(taskId: string): WorkbenchTaskDetail | null {
    return this.repository.getDetail(taskId);
  }

  beginRun(input: {
    sessionId: string;
    goal: string;
    contract: WorkbenchTaskContract;
    trigger?: WorkbenchRunTrigger;
    preparedRunId?: string;
  }): { task: WorkbenchTask; run: WorkbenchRun } {
    const result = this.repository.transaction(() => {
      let run = input.preparedRunId ? this.repository.getRun(input.preparedRunId) : null;
      let task = run
        ? this.repository.getTask(run.taskId)
        : this.repository.getActiveTaskForSession(input.sessionId);
      if (!task) task = this.repository.createTask(input.sessionId, input.goal, input.contract);
      if (run && run.taskId !== task.id) throw new Error('Prepared run does not belong to task.');
      if (!run) {
        run = this.repository.createRun(task.id, input.trigger ?? WorkbenchRunTrigger.Message);
      }
      task = this.repository.updateTaskStatus(task.id, WorkbenchTaskStatus.Running, run.id);
      run = this.repository.updateRunStatus(run.id, WorkbenchRunStatus.Running);
      this.repository.appendRunEvent(run.id, WorkbenchRunEventType.RunStarted);
      return { task, run };
    });
    this.emitChanged(result.task);
    return result;
  }

  prepareRun(
    taskId: string,
    trigger: WorkbenchRunTrigger,
  ): { task: WorkbenchTask; run: WorkbenchRun } {
    const result = this.repository.transaction(() => {
      let task = this.repository.getTask(taskId);
      if (!task) throw new Error('Workbench task not found.');
      if (task.activeRunId) {
        for (const approval of this.repository.listApprovalsForRun(task.activeRunId)) {
          if (approval.decision !== WorkbenchApprovalDecision.Pending) continue;
          this.repository.updateApproval(approval.id, {
            decision: WorkbenchApprovalDecision.Expired,
            decisionSource: WorkbenchApprovalDecisionSource.Recovery,
            result: { reason: 'The interrupted approval was superseded by a new run.' },
          });
          this.repository.appendRunEvent(approval.runId, WorkbenchRunEventType.ApprovalResolved, {
            approvalId: approval.id,
            approved: false,
            expired: true,
          });
        }
      }
      const run = this.repository.createRun(task.id, trigger);
      task = this.repository.updateTaskStatus(task.id, WorkbenchTaskStatus.Running, run.id);
      return { task, run };
    });
    this.emitChanged(result.task);
    return result;
  }

  completeRun(input: {
    sessionId: string;
    runId: string;
    workspaceRoot: string;
    finalAnswer: string;
    finalMessageId?: string | null;
    workflowCompleted?: boolean;
    workflowSnapshot?: Record<string, unknown> | null;
    streamClosedCleanly?: boolean;
  }): WorkbenchTaskDetail {
    const run = this.requireRun(input.runId);
    const task = this.requireTask(run.taskId);
    if (run.status !== WorkbenchRunStatus.Running) {
      const current = this.repository.getDetail(task.id);
      if (!current) throw new Error('Workbench task detail disappeared before verification.');
      return current;
    }
    const verificationContext: WorkbenchVerificationContext = {
      contract: task.contract,
      finalAnswer: input.finalAnswer,
      streamClosedCleanly: input.streamClosedCleanly !== false,
      workflowCompleted: input.workflowCompleted,
      workflowSnapshot: input.workflowSnapshot,
    };
    const result = verifyWorkbenchRun(verificationContext);
    const toolArtifacts = this.repository
      .listApprovalsForRun(run.id)
      .filter(approval => approval.effectStatus === WorkbenchApprovalEffectStatus.Succeeded)
      .flatMap(approval => {
        const pathValue =
          approval.request.path ?? approval.request.file_path ?? approval.request.filePath;
        return typeof pathValue === 'string'
          ? [{ path: pathValue, toolName: approval.toolName, toolCallId: approval.toolCallId }]
          : [];
      });
    this.repository.transaction(() => {
      this.repository.updateRunStatus(run.id, WorkbenchRunStatus.Verifying);
      this.repository.appendRunEvent(run.id, WorkbenchRunEventType.VerificationStarted);
      for (const artifact of collectWorkbenchArtifacts({
        taskId: task.id,
        runId: run.id,
        workspaceRoot: input.workspaceRoot,
        finalAnswer: input.finalAnswer,
        finalMessageId: input.finalMessageId,
        workflowSnapshot: input.workflowSnapshot,
        toolArtifacts,
      })) {
        this.repository.addArtifact(artifact);
      }
      if (result.outcome === WorkbenchVerificationOutcome.Passed) {
        this.repository.updateRunStatus(run.id, WorkbenchRunStatus.Succeeded, {
          verificationResult: result,
        });
        this.repository.updateTaskStatus(task.id, WorkbenchTaskStatus.Completed, null);
      } else {
        this.repository.updateRunStatus(run.id, WorkbenchRunStatus.NeedsReview, {
          verificationResult: result,
        });
        this.repository.updateTaskStatus(task.id, WorkbenchTaskStatus.NeedsReview, run.id);
      }
      this.repository.appendRunEvent(run.id, WorkbenchRunEventType.VerificationFinished, {
        outcome: result.outcome,
        summary: result.summary,
      });
      this.measurement.recordVerification(run.id, {
        passed: result.outcome === WorkbenchVerificationOutcome.Passed,
        outcome: result.outcome,
        checks: result.checks.map(check => ({ name: check.name, status: check.status })),
      });
      this.productionLoop.recordVerificationResult(run.id, result.outcome, result.summary);
    });
    const detail = this.repository.getDetail(task.id);
    if (!detail) throw new Error('Workbench task detail disappeared after verification.');
    this.emitChanged(detail.task);
    return detail;
  }

  acceptTask(taskId: string): WorkbenchTaskDetail {
    const detail = this.repository.getDetail(taskId);
    if (!detail) throw new Error('Workbench task not found.');
    const run = detail.runs.find(candidate => candidate.id === detail.task.activeRunId);
    if (
      detail.task.status !== WorkbenchTaskStatus.NeedsReview ||
      !run?.verificationResult ||
      run.verificationResult.outcome !== WorkbenchVerificationOutcome.AcceptanceRequired
    ) {
      throw new Error('This task cannot be accepted because deterministic verification failed.');
    }
    const acceptedResult: WorkbenchVerificationResult = {
      ...run.verificationResult,
      outcome: WorkbenchVerificationOutcome.Passed,
      checks: [
        ...run.verificationResult.checks,
        {
          name: 'user_acceptance',
          status: WorkbenchVerificationCheckStatus.Passed,
        },
      ],
      summary: 'The user accepted the work result.',
    };
    this.repository.transaction(() => {
      this.repository.updateRunStatus(run.id, WorkbenchRunStatus.Succeeded, {
        verificationResult: acceptedResult,
      });
      this.repository.updateTaskStatus(taskId, WorkbenchTaskStatus.Completed, null);
      this.repository.appendRunEvent(run.id, WorkbenchRunEventType.VerificationFinished, {
        outcome: acceptedResult.outcome,
        acceptedByUser: true,
      });
      this.productionLoop.recordVerificationResult(
        run.id,
        WorkbenchVerificationOutcome.Passed,
        acceptedResult.summary,
      );
    });
    const accepted = this.repository.getDetail(taskId);
    if (!accepted) throw new Error('Workbench task not found after acceptance.');
    this.emitChanged(accepted.task);
    return accepted;
  }

  pauseRun(sessionId: string, reason: string): void {
    const task = this.repository.getActiveTaskForSession(sessionId);
    if (!task?.activeRunId) return;
    const run = this.repository.getRun(task.activeRunId);
    if (!run || !this.isRunActive(run.status)) return;
    this.repository.transaction(() => {
      this.repository.updateRunStatus(run.id, WorkbenchRunStatus.Paused);
      this.repository.updateTaskStatus(task.id, WorkbenchTaskStatus.Paused, run.id);
      this.repository.appendRunEvent(run.id, WorkbenchRunEventType.RunPaused, { reason });
    });
    this.emitChanged(this.requireTask(task.id));
  }

  failRun(sessionId: string, failure: WorkbenchJsonObject): void {
    const task = this.repository.getActiveTaskForSession(sessionId);
    if (!task?.activeRunId) return;
    const run = this.repository.getRun(task.activeRunId);
    if (!run || !this.isRunActive(run.status)) return;
    this.repository.transaction(() => {
      this.repository.updateRunStatus(run.id, WorkbenchRunStatus.Failed, { failure });
      this.repository.updateTaskStatus(task.id, WorkbenchTaskStatus.Failed, null);
      this.repository.appendRunEvent(run.id, WorkbenchRunEventType.RunFailed, failure);
      this.measurement.recordFailure(run.id, {
        message: typeof failure.message === 'string' ? failure.message : 'Unknown runtime failure',
        code: typeof failure.code === 'string' ? failure.code : undefined,
        stage: typeof failure.stage === 'string' ? failure.stage : 'runtime',
        evidence: failure,
      });
    });
    this.emitChanged(this.requireTask(task.id));
  }

  async authorizeToolCall(input: {
    sessionId: string;
    runId: string;
    toolCallId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    autoApprove: boolean;
  }): Promise<WorkbenchToolAuthorizationResult> {
    const run = this.requireRun(input.runId);
    const task = this.requireTask(run.taskId);
    if (task.sessionId !== input.sessionId) {
      return { allow: false, reason: 'The tool call does not belong to this session.' };
    }
    if (task.activeRunId !== run.id || run.status !== WorkbenchRunStatus.Running) {
      return { allow: false, reason: 'The tool call does not belong to the active run.' };
    }
    const riskLevel = classifyWorkbenchToolRisk(input.toolName, input.toolInput);
    if (riskLevel === WorkbenchApprovalRiskLevel.ReadOnly) {
      this.repository.appendRunEvent(run.id, WorkbenchRunEventType.ToolRead, {
        toolCallId: input.toolCallId,
        toolName: input.toolName,
      });
      return { allow: true };
    }
    const idempotencyKey = createToolIdempotencyKey(run.id, input.toolCallId, input.toolInput);
    const existing = this.repository.getApprovalByIdempotencyKey(idempotencyKey);
    if (existing) {
      this.measurement.recordActivation(run.id, {
        activation: HarnessActivationType.RepeatToolBreakerFired,
        mechanism: 'tool_effect_idempotency',
        evidence: { toolCallId: input.toolCallId, toolName: input.toolName },
      });
      if (this.productionLoop.repository.get(run.id)) {
        this.productionLoop.recordRecovery(
          run.id,
          ProductionLoopRecoveryReason.RepeatedToolCall,
          `Blocked duplicate side effect for ${input.toolName}.`,
        );
      }
      return { allow: false, reason: this.getDuplicateApprovalReason(existing) };
    }
    // "Allow all" means the user has explicitly disabled tool authorization
    // prompts for this run, including irreversible effects.
    const canAutoApprove = input.autoApprove;
    const approval = this.repository.transaction(() => {
      const created = this.repository.createApproval({
        taskId: task.id,
        runId: run.id,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        riskLevel,
        decision: canAutoApprove
          ? WorkbenchApprovalDecision.Approved
          : WorkbenchApprovalDecision.Pending,
        decisionSource: canAutoApprove ? WorkbenchApprovalDecisionSource.Policy : null,
        effectStatus: canAutoApprove
          ? WorkbenchApprovalEffectStatus.Executing
          : WorkbenchApprovalEffectStatus.NotStarted,
        idempotencyKey,
        request: input.toolInput,
      });
      this.repository.appendRunEvent(run.id, WorkbenchRunEventType.ApprovalRequested, {
        approvalId: created.id,
        riskLevel,
        automatic: canAutoApprove,
      });
      if (canAutoApprove) {
        this.repository.appendRunEvent(run.id, WorkbenchRunEventType.ToolEffectStarted, {
          approvalId: created.id,
        });
      } else {
        this.repository.updateRunStatus(run.id, WorkbenchRunStatus.WaitingApproval);
      }
      return created;
    });
    this.emitChanged(task);
    if (canAutoApprove) return { allow: true };
    this.emit('approvalRequested', { sessionId: input.sessionId, approval });
    return new Promise(resolve => {
      this.pendingApprovals.set(approval.id, { resolve });
    });
  }

  respondToApproval(input: WorkbenchApprovalResponseInput): WorkbenchApproval {
    const approval = this.repository.getApproval(input.approvalId);
    if (!approval) throw new Error('Workbench approval not found.');
    if (approval.decision !== WorkbenchApprovalDecision.Pending) return approval;
    const pending = this.pendingApprovals.get(approval.id);
    if (!pending) {
      throw new Error('This approval belongs to an interrupted run. Resume the task to try again.');
    }
    const updated = this.repository.transaction(() => {
      const next = this.repository.updateApproval(approval.id, {
        decision: input.approved
          ? WorkbenchApprovalDecision.Approved
          : WorkbenchApprovalDecision.Denied,
        decisionSource: WorkbenchApprovalDecisionSource.User,
        effectStatus: input.approved
          ? WorkbenchApprovalEffectStatus.Executing
          : WorkbenchApprovalEffectStatus.NotStarted,
        result: input.reason ? { reason: input.reason } : null,
      });
      this.repository.updateRunStatus(
        approval.runId,
        input.approved ? WorkbenchRunStatus.Running : WorkbenchRunStatus.Paused,
      );
      if (!input.approved) {
        this.repository.updateTaskStatus(
          approval.taskId,
          WorkbenchTaskStatus.Paused,
          approval.runId,
        );
      }
      this.repository.appendRunEvent(approval.runId, WorkbenchRunEventType.ApprovalResolved, {
        approvalId: approval.id,
        approved: input.approved,
      });
      if (input.approved) {
        this.repository.appendRunEvent(approval.runId, WorkbenchRunEventType.ToolEffectStarted, {
          approvalId: approval.id,
        });
      }
      return next;
    });
    this.pendingApprovals.delete(approval.id);
    pending.resolve(
      input.approved
        ? { allow: true }
        : { allow: false, reason: input.reason || 'The user denied this action.' },
    );
    this.emitChanged(this.requireTask(approval.taskId));
    return updated;
  }

  recordToolResult(runId: string, toolCallId: string, result: unknown, isError: boolean): void {
    const approval = this.repository.getApprovalByToolCall(runId, toolCallId);
    if (!approval || approval.effectStatus !== WorkbenchApprovalEffectStatus.Executing) return;
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

  recoverInterruptedState(): number {
    const affectedTaskIds = new Set<string>();
    const interruptedApprovalIds = new Set<string>();
    this.repository.transaction(() => {
      for (const run of this.repository.listRecoverableRuns()) {
        const task = this.requireTask(run.taskId);
        if (run.status === WorkbenchRunStatus.WaitingApproval) {
          for (const approval of this.repository.listApprovalsForRun(run.id)) {
            if (approval.decision !== WorkbenchApprovalDecision.Pending) continue;
            interruptedApprovalIds.add(approval.id);
          }
          this.repository.updateRunStatus(run.id, WorkbenchRunStatus.Paused);
          // A task may already require review because another interrupted run
          // or approval effect was recovered first. Do not downgrade that
          // stronger recovery state back to paused.
          if (task.status === WorkbenchTaskStatus.Running) {
            this.repository.updateTaskStatus(task.id, WorkbenchTaskStatus.Paused, run.id);
          }
        } else {
          this.repository.updateRunStatus(run.id, WorkbenchRunStatus.NeedsReview);
          if (task.status === WorkbenchTaskStatus.Running) {
            this.repository.updateTaskStatus(task.id, WorkbenchTaskStatus.NeedsReview, run.id);
          }
        }
        this.repository.appendRunEvent(run.id, WorkbenchRunEventType.RecoveryRequired, {
          previousStatus: run.status,
        });
        affectedTaskIds.add(task.id);
      }
      for (const approval of this.repository.listExecutingApprovals()) {
        this.repository.updateApproval(approval.id, {
          effectStatus: WorkbenchApprovalEffectStatus.NeedsReview,
          decisionSource: approval.decisionSource ?? WorkbenchApprovalDecisionSource.Recovery,
        });
        const run = this.repository.getRun(approval.runId);
        const task = this.repository.getTask(approval.taskId);
        if (run && this.isRunActive(run.status)) {
          this.repository.updateRunStatus(run.id, WorkbenchRunStatus.NeedsReview);
        }
        if (task && task.status === WorkbenchTaskStatus.Running) {
          this.repository.updateTaskStatus(
            task.id,
            WorkbenchTaskStatus.NeedsReview,
            run?.id ?? null,
          );
        }
        affectedTaskIds.add(approval.taskId);
      }
    });
    for (const approvalId of interruptedApprovalIds) {
      const pending = this.pendingApprovals.get(approvalId);
      this.pendingApprovals.delete(approvalId);
      pending?.resolve({
        allow: false,
        reason: 'The run was interrupted before the approval was resolved.',
      });
    }
    for (const taskId of affectedTaskIds) this.emitChanged(this.requireTask(taskId));
    return affectedTaskIds.size;
  }

  deleteSession(sessionId: string): void {
    this.repository.transaction(() => {
      this.productionLoop.deleteSession(sessionId);
      this.repository.deleteSessionDomainData(sessionId);
    });
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

  private requireRun(runId: string): WorkbenchRun {
    const run = this.repository.getRun(runId);
    if (!run) throw new Error(`Workbench run not found: ${runId}`);
    return run;
  }

  private isRunActive(status: WorkbenchRun['status']): boolean {
    return new Set<WorkbenchRun['status']>([
      WorkbenchRunStatus.Queued,
      WorkbenchRunStatus.Running,
      WorkbenchRunStatus.WaitingApproval,
      WorkbenchRunStatus.Verifying,
    ]).has(status);
  }

  private getDuplicateApprovalReason(approval: WorkbenchApproval): string {
    if (approval.effectStatus === WorkbenchApprovalEffectStatus.Succeeded) {
      const persistedResult = approval.result ? JSON.stringify(approval.result) : '{}';
      return `This side effect was already executed. Reuse the persisted result: ${persistedResult}`;
    }
    if (
      approval.effectStatus === WorkbenchApprovalEffectStatus.Executing ||
      approval.effectStatus === WorkbenchApprovalEffectStatus.NeedsReview
    ) {
      return 'The previous side effect has an uncertain outcome.';
    }
    if (approval.decision === WorkbenchApprovalDecision.Pending) {
      return 'This side effect is already waiting for approval.';
    }
    return 'This side effect was already attempted and cannot be replayed in the same run.';
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
      if (!candidate || typeof candidate !== 'object') return String(candidate);
      if (remainingNodes <= 0) return '[Truncated]';
      if (depth >= MAX_RESULT_DEPTH) return '[MaxDepth]';
      if (seen.has(candidate)) return '[Circular]';
      seen.add(candidate);
      remainingNodes -= 1;

      if (candidate instanceof Error) {
        return {
          name: candidate.name,
          message: normalize(candidate.message, depth + 1),
          stack: normalize(candidate.stack, depth + 1),
        };
      }
      if (Array.isArray(candidate)) {
        return candidate
          .slice(0, MAX_RESULT_COLLECTION_ENTRIES)
          .map(item => normalize(item, depth + 1));
      }

      const normalized: WorkbenchJsonObject = {};
      for (const [key, child] of Object.entries(candidate).slice(
        0,
        MAX_RESULT_COLLECTION_ENTRIES,
      )) {
        try {
          normalized[key] = normalize(child, depth + 1);
        } catch {
          normalized[key] = '[Unreadable]';
        }
      }
      return normalized;
    };

    const normalized = normalize(value, 0);
    const object =
      normalized && typeof normalized === 'object' && !Array.isArray(normalized)
        ? (normalized as WorkbenchJsonObject)
        : { value: normalized };
    const serialized = JSON.stringify(object);
    if (serialized.length > MAX_RESULT_SERIALIZED_LENGTH) {
      return {
        truncated: true,
        preview: serialized.slice(0, MAX_RESULT_SERIALIZED_LENGTH),
      };
    }
    return object;
  }
}
