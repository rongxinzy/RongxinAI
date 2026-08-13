import type {
  DeliveryMode,
  DeliveryStatus,
  SessionTarget,
  TaskStatus,
  WakeMode,
} from './constants';

export interface ScheduleAt {
  kind: 'at';
  at: string;
}

export interface ScheduleEvery {
  kind: 'every';
  everyMs: number;
  anchorMs?: number;
}

export interface ScheduleCron {
  kind: 'cron';
  expr: string;
  tz?: string;
  staggerMs?: number;
}

export type Schedule = ScheduleAt | ScheduleEvery | ScheduleCron;

export interface AgentTurnPayload {
  kind: 'agentTurn';
  message: string;
  timeoutSeconds?: number;
  model?: string;
}

export interface SystemEventPayload {
  kind: 'systemEvent';
  text: string;
}

export type ScheduledTaskPayload = AgentTurnPayload | SystemEventPayload;

export interface ScheduledTaskDelivery {
  mode: DeliveryMode;
  channel?: string;
  to?: string;
  accountId?: string;
  bestEffort?: boolean;
}

export type TaskLastStatus = TaskStatus | null;

export interface TaskState {
  nextRunAtMs: number | null;
  lastRunAtMs: number | null;
  lastStatus: TaskLastStatus;
  lastError: string | null;
  lastDurationMs: number | null;
  runningAtMs: number | null;
  consecutiveErrors: number;
}

export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  schedule: Schedule;
  sessionTarget: SessionTarget;
  wakeMode: WakeMode;
  payload: ScheduledTaskPayload;
  delivery: ScheduledTaskDelivery;
  /** Workspace whose configuration and working directory are inherited when the task runs. */
  workspaceId: string | null;
  sessionKey: string | null;
  /** Changes whenever a trigger-affecting task definition changes. */
  scheduleVersion?: string;
  state: TaskState;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskRun {
  id: string;
  taskId: string;
  sessionId: string | null;
  sessionKey: string | null;
  status: TaskStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
}

export interface ScheduledTaskRunWithName extends ScheduledTaskRun {
  taskName: string;
  taskPayload?: string;
}

/** Immutable result of one attempt to deliver a completed canonical Run. */
export interface ScheduledTaskDeliveryRecord {
  id: string;
  runId: string;
  taskId: string;
  mode: DeliveryMode;
  channel: string | null;
  to: string | null;
  accountId: string | null;
  status: DeliveryStatus;
  attemptedAt: string;
  deliveredAt: string | null;
  receiptId: string | null;
  error: string | null;
}

export interface ScheduledTaskInput {
  name: string;
  description: string;
  enabled: boolean;
  schedule: Schedule;
  sessionTarget: SessionTarget;
  wakeMode: WakeMode;
  payload: ScheduledTaskPayload;
  delivery?: ScheduledTaskDelivery;
  /** Workspace whose configuration and working directory are inherited when the task runs. */
  workspaceId?: string | null;
  sessionKey?: string | null;
}

export interface ScheduledTaskStatusEvent {
  taskId: string;
  state: TaskState;
}

export interface ScheduledTaskRunEvent {
  run: ScheduledTaskRunWithName;
}

export interface ScheduledTaskChannelOption {
  value: string;
  label: string;
  /** Multi-instance platforms use this stable instance selector as
   *  `delivery.accountId`. Plugins may internally map it to a protocol-level
   *  account identity such as appKey:accid. */
  accountId?: string;
  /** Optional account identifier used only when querying local conversation
   *  mappings. Some adapters persist a different routing-safe account prefix
   *  than the delivery-time accountId. */
  filterAccountId?: string;
}

export interface ScheduledTaskConversationOption {
  conversationId: string;
  platform: string;
  coworkSessionId: string;
  lastActiveAt: number;
}

export type ScheduledTaskViewMode = 'list' | 'create' | 'edit' | 'detail';

export interface RunFilter {
  /** ISO date string (YYYY-MM-DD), inclusive lower bound for startedAt */
  startDate?: string;
  /** ISO date string (YYYY-MM-DD), inclusive upper bound for startedAt */
  endDate?: string;
  /** Filter by task run status */
  status?: string;
}
