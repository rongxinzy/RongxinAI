import {
  WorkbenchRunStatus,
  type WorkbenchRunStatus as WorkbenchRunStatusType,
  WorkbenchTaskStatus,
  type WorkbenchTaskStatus as WorkbenchTaskStatusType,
} from '../../shared/workbenchTask';

const taskTransitions: Record<WorkbenchTaskStatusType, ReadonlySet<WorkbenchTaskStatusType>> = {
  [WorkbenchTaskStatus.Draft]: new Set([
    WorkbenchTaskStatus.Planned,
    WorkbenchTaskStatus.Cancelled,
  ]),
  [WorkbenchTaskStatus.Planned]: new Set([
    WorkbenchTaskStatus.Running,
    WorkbenchTaskStatus.Cancelled,
  ]),
  [WorkbenchTaskStatus.Running]: new Set([
    WorkbenchTaskStatus.Paused,
    WorkbenchTaskStatus.NeedsReview,
    WorkbenchTaskStatus.Completed,
    WorkbenchTaskStatus.Failed,
    WorkbenchTaskStatus.Cancelled,
  ]),
  [WorkbenchTaskStatus.Paused]: new Set([
    WorkbenchTaskStatus.Running,
    WorkbenchTaskStatus.Cancelled,
  ]),
  [WorkbenchTaskStatus.NeedsReview]: new Set([
    WorkbenchTaskStatus.Running,
    WorkbenchTaskStatus.Completed,
    WorkbenchTaskStatus.Failed,
    WorkbenchTaskStatus.Cancelled,
  ]),
  [WorkbenchTaskStatus.Completed]: new Set([WorkbenchTaskStatus.Running]),
  [WorkbenchTaskStatus.Failed]: new Set([WorkbenchTaskStatus.Running]),
  [WorkbenchTaskStatus.Cancelled]: new Set(),
};

const runTransitions: Record<WorkbenchRunStatusType, ReadonlySet<WorkbenchRunStatusType>> = {
  [WorkbenchRunStatus.Queued]: new Set([
    WorkbenchRunStatus.Running,
    WorkbenchRunStatus.Cancelled,
    WorkbenchRunStatus.Failed,
  ]),
  [WorkbenchRunStatus.Running]: new Set([
    WorkbenchRunStatus.WaitingApproval,
    WorkbenchRunStatus.Verifying,
    WorkbenchRunStatus.Paused,
    WorkbenchRunStatus.NeedsReview,
    WorkbenchRunStatus.Failed,
    WorkbenchRunStatus.Cancelled,
  ]),
  [WorkbenchRunStatus.WaitingApproval]: new Set([
    WorkbenchRunStatus.Running,
    WorkbenchRunStatus.Paused,
    WorkbenchRunStatus.NeedsReview,
    WorkbenchRunStatus.Failed,
    WorkbenchRunStatus.Cancelled,
  ]),
  [WorkbenchRunStatus.Verifying]: new Set([
    WorkbenchRunStatus.Succeeded,
    WorkbenchRunStatus.NeedsReview,
    WorkbenchRunStatus.Failed,
  ]),
  [WorkbenchRunStatus.Paused]: new Set(),
  [WorkbenchRunStatus.NeedsReview]: new Set([WorkbenchRunStatus.Succeeded]),
  [WorkbenchRunStatus.Succeeded]: new Set(),
  [WorkbenchRunStatus.Failed]: new Set(),
  [WorkbenchRunStatus.Cancelled]: new Set(),
};

export class WorkbenchStateTransitionError extends Error {
  constructor(
    readonly entity: 'task' | 'run',
    readonly from: string,
    readonly to: string,
  ) {
    super(`Invalid workbench ${entity} transition: ${from} -> ${to}`);
    this.name = 'WorkbenchStateTransitionError';
  }
}

export function assertTaskTransition(
  from: WorkbenchTaskStatusType,
  to: WorkbenchTaskStatusType,
): void {
  if (from === to) return;
  if (!taskTransitions[from].has(to)) {
    throw new WorkbenchStateTransitionError('task', from, to);
  }
}

export function assertRunTransition(
  from: WorkbenchRunStatusType,
  to: WorkbenchRunStatusType,
): void {
  if (from === to) return;
  if (!runTransitions[from].has(to)) {
    throw new WorkbenchStateTransitionError('run', from, to);
  }
}
