import type Database from 'better-sqlite3';
import { EventEmitter } from 'events';

import {
  WorkbenchRunEventType,
  WorkbenchRunStatus,
  WorkbenchRunTrigger,
  WorkbenchTaskStatus,
  WorkbenchVerificationCheckStatus,
  WorkbenchVerificationOutcome,
  type WorkbenchJsonObject,
  type WorkbenchRun,
  type WorkbenchTask,
  type WorkbenchTaskChangedEvent,
  type WorkbenchTaskContract,
  type WorkbenchTaskDetail,
  type WorkbenchVerificationResult,
} from '../../shared/workbenchTask';
import { WorkbenchTaskRepository } from './repository';

const pendingVerification: WorkbenchVerificationResult = {
  outcome: WorkbenchVerificationOutcome.AcceptanceRequired,
  checks: [
    {
      name: 'contract_verifier',
      status: WorkbenchVerificationCheckStatus.Skipped,
      detail: 'Contract verification is handled by the verifier registry.',
    },
  ],
  evidence: [],
  summary: 'The run ended and is waiting for contract verification.',
};

export class WorkbenchTaskService extends EventEmitter {
  readonly repository: WorkbenchTaskRepository;

  constructor(db: Database.Database) {
    super();
    this.repository = new WorkbenchTaskRepository(db);
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
      let task = this.requireTask(taskId);
      const run = this.repository.createRun(task.id, trigger);
      task = this.repository.updateTaskStatus(task.id, WorkbenchTaskStatus.Running, run.id);
      return { task, run };
    });
    this.emitChanged(result.task);
    return result;
  }

  completeRun(runId: string): WorkbenchTaskDetail {
    const run = this.requireRun(runId);
    const task = this.requireTask(run.taskId);
    if (run.status !== WorkbenchRunStatus.Running) {
      return this.requireDetail(task.id);
    }
    this.repository.transaction(() => {
      this.repository.updateRunStatus(run.id, WorkbenchRunStatus.Verifying);
      this.repository.appendRunEvent(run.id, WorkbenchRunEventType.VerificationStarted);
      this.repository.updateRunStatus(run.id, WorkbenchRunStatus.NeedsReview, {
        verificationResult: pendingVerification,
      });
      this.repository.updateTaskStatus(task.id, WorkbenchTaskStatus.NeedsReview, run.id);
      this.repository.appendRunEvent(run.id, WorkbenchRunEventType.VerificationFinished, {
        outcome: pendingVerification.outcome,
      });
    });
    const detail = this.requireDetail(task.id);
    this.emitChanged(detail.task);
    return detail;
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
    });
    this.emitChanged(this.requireTask(task.id));
  }

  recoverInterruptedState(): number {
    const affectedTaskIds = new Set<string>();
    this.repository.transaction(() => {
      for (const run of this.repository.listRecoverableRuns()) {
        const task = this.requireTask(run.taskId);
        this.repository.updateRunStatus(run.id, WorkbenchRunStatus.NeedsReview);
        this.repository.updateTaskStatus(task.id, WorkbenchTaskStatus.NeedsReview, run.id);
        this.repository.appendRunEvent(run.id, WorkbenchRunEventType.RecoveryRequired, {
          previousStatus: run.status,
        });
        affectedTaskIds.add(task.id);
      }
    });
    for (const taskId of affectedTaskIds) this.emitChanged(this.requireTask(taskId));
    return affectedTaskIds.size;
  }

  deleteSession(sessionId: string): void {
    this.repository.deleteSessionDomainData(sessionId);
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

  private requireDetail(taskId: string): WorkbenchTaskDetail {
    const detail = this.repository.getDetail(taskId);
    if (!detail) throw new Error(`Workbench task detail not found: ${taskId}`);
    return detail;
  }

  private isRunActive(status: WorkbenchRun['status']): boolean {
    return new Set<WorkbenchRun['status']>([
      WorkbenchRunStatus.Queued,
      WorkbenchRunStatus.Running,
      WorkbenchRunStatus.WaitingApproval,
      WorkbenchRunStatus.Verifying,
    ]).has(status);
  }
}
