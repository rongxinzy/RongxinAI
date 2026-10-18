/**
 * Automation IPC contracts (channel + args + result), single source of truth
 * for the scheduled-task handlers (`src/main/ipcHandlers/scheduledTask/`), the
 * activity list handler, the `scheduledTasks`/`activity` preload namespaces,
 * and the renderer `ScheduledTasksApi`/`ActivityApi` types.
 *
 * `ScheduledTaskInput` previously crossed IPC as `any`; the schema here
 * encodes the real shape the renderer's `buildTaskInput`
 * (`src/renderer/components/scheduledTasks/taskFormState.ts`) submits, and
 * `update` accepts the partial variant the edit flow sends. Results document
 * the envelope fields the renderer reads; they are not stripped at runtime.
 */
import { z } from 'zod';

import { defineIpcContract } from './contract';
import {
  DeliveryMode,
  DeliveryStatus,
  IpcChannel as ScheduledTaskIpc,
  PayloadKind,
  ScheduleKind,
  SessionTarget,
  TaskStatus,
  WakeMode,
} from '../../scheduledTask/constants';
import { ActivityIpc, ActivitySource, ActivityStatus } from '../activity/constants';

const ScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(ScheduleKind.At), at: z.string() }),
  z.object({
    kind: z.literal(ScheduleKind.Every),
    everyMs: z.number(),
    anchorMs: z.number().optional(),
  }),
  z.object({
    kind: z.literal(ScheduleKind.Cron),
    expr: z.string(),
    tz: z.string().optional(),
    staggerMs: z.number().optional(),
  }),
]);

const ScheduledTaskPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(PayloadKind.AgentTurn),
    message: z.string(),
    timeoutSeconds: z.number().optional(),
    model: z.string().optional(),
  }),
  z.object({ kind: z.literal(PayloadKind.SystemEvent), text: z.string() }),
]);

const ScheduledTaskDeliverySchema = z.object({
  mode: z.enum([DeliveryMode.None, DeliveryMode.Announce, DeliveryMode.Webhook]),
  channel: z.string().optional(),
  to: z.string().optional(),
  accountId: z.string().optional(),
  bestEffort: z.boolean().optional(),
});

/** Shape the task form submits (buildTaskInput in taskFormState.ts). */
const ScheduledTaskInputSchema = z.object({
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  schedule: ScheduleSchema,
  sessionTarget: z.enum([SessionTarget.Main, SessionTarget.Isolated, SessionTarget.Task]),
  wakeMode: z.enum([WakeMode.Now, WakeMode.NextHeartbeat]),
  payload: ScheduledTaskPayloadSchema,
  delivery: ScheduledTaskDeliverySchema.optional(),
  workspaceId: z.string().nullable().optional(),
  sessionKey: z.string().nullable().optional(),
});

/** Edit flow sends only the changed fields (Partial<ScheduledTaskInput>). */
const ScheduledTaskInputPatchSchema = ScheduledTaskInputSchema.partial();

const RunFilterSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.string().optional(),
});

const TaskStateSchema = z.object({
  nextRunAtMs: z.number().nullable(),
  lastRunAtMs: z.number().nullable(),
  lastStatus: z
    .enum([TaskStatus.Success, TaskStatus.Error, TaskStatus.Skipped, TaskStatus.Running])
    .nullable(),
  lastError: z.string().nullable(),
  lastDurationMs: z.number().nullable(),
  runningAtMs: z.number().nullable(),
  consecutiveErrors: z.number(),
});

/** `ScheduledTask` row as returned by the canonical SQLite task service. */
const ScheduledTaskSchema = ScheduledTaskInputSchema.extend({
  id: z.string(),
  workspaceId: z.string().nullable(),
  sessionKey: z.string().nullable(),
  scheduleVersion: z.string().optional(),
  state: TaskStateSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  delivery: ScheduledTaskDeliverySchema,
});

const ScheduledTaskRunSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  sessionId: z.string().nullable(),
  sessionKey: z.string().nullable(),
  status: z.enum([TaskStatus.Success, TaskStatus.Error, TaskStatus.Skipped, TaskStatus.Running]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  error: z.string().nullable(),
});

const ScheduledTaskRunWithNameSchema = ScheduledTaskRunSchema.extend({
  taskName: z.string(),
  taskPayload: z.string().optional(),
});

const ScheduledTaskDeliveryRecordSchema = z.object({
  id: z.string(),
  runId: z.string(),
  taskId: z.string(),
  mode: z.enum([DeliveryMode.None, DeliveryMode.Announce, DeliveryMode.Webhook]),
  channel: z.string().nullable(),
  to: z.string().nullable(),
  accountId: z.string().nullable(),
  status: z.enum([
    DeliveryStatus.Pending,
    DeliveryStatus.Success,
    DeliveryStatus.Error,
    DeliveryStatus.Skipped,
  ]),
  attemptedAt: z.string(),
  deliveredAt: z.string().nullable(),
  receiptId: z.string().nullable(),
  error: z.string().nullable(),
});

const ScheduledTaskChannelOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  accountId: z.string().optional(),
  filterAccountId: z.string().optional(),
});

const ScheduledTaskConversationOptionSchema = z.object({
  conversationId: z.string(),
  platform: z.string(),
  coworkSessionId: z.string(),
  lastActiveAt: z.number(),
});

export const scheduledTasksContract = defineIpcContract({
  list: {
    channel: ScheduledTaskIpc.List,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      tasks: z.array(ScheduledTaskSchema).optional(),
      error: z.string().optional(),
    }),
  },
  get: {
    channel: ScheduledTaskIpc.Get,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      task: ScheduledTaskSchema.optional(),
      error: z.string().optional(),
    }),
  },
  create: {
    channel: ScheduledTaskIpc.Create,
    args: z.tuple([ScheduledTaskInputSchema]),
    result: z.object({
      success: z.boolean(),
      task: ScheduledTaskSchema.optional(),
      error: z.string().optional(),
    }),
  },
  update: {
    channel: ScheduledTaskIpc.Update,
    args: z.tuple([z.string(), ScheduledTaskInputPatchSchema]),
    result: z.object({
      success: z.boolean(),
      task: ScheduledTaskSchema.optional(),
      error: z.string().optional(),
    }),
  },
  delete: {
    channel: ScheduledTaskIpc.Delete,
    args: z.tuple([z.string()]),
    // Handler reports whether the job existed (`result: true/false`).
    result: z.object({
      success: z.boolean(),
      result: z.boolean().optional(),
      error: z.string().optional(),
    }),
  },
  toggle: {
    channel: ScheduledTaskIpc.Toggle,
    args: z.tuple([z.string(), z.boolean()]),
    result: z.object({
      success: z.boolean(),
      task: ScheduledTaskSchema.optional(),
      warning: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  runManually: {
    channel: ScheduledTaskIpc.RunManually,
    args: z.tuple([z.string()]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  stop: {
    channel: ScheduledTaskIpc.Stop,
    args: z.tuple([z.string()]),
    // Handler returns `result: false` — a claimed Pi Run finishes on its own.
    result: z.object({
      success: z.boolean(),
      result: z.boolean().optional(),
      error: z.string().optional(),
    }),
  },
  preflight: {
    channel: ScheduledTaskIpc.Preflight,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      error: z.string().optional(),
      preflight: z
        .object({
          hasChannel: z.boolean(),
          channel: z.string().optional(),
          latestDelivery: ScheduledTaskDeliveryRecordSchema.nullable().optional(),
        })
        .optional(),
    }),
  },
  listRuns: {
    channel: ScheduledTaskIpc.ListRuns,
    args: z.tuple([
      z.string(),
      z.number().optional(),
      z.number().optional(),
      RunFilterSchema.optional(),
    ]),
    result: z.object({
      success: z.boolean(),
      runs: z.array(ScheduledTaskRunSchema).optional(),
      error: z.string().optional(),
    }),
  },
  listDeliveries: {
    channel: ScheduledTaskIpc.ListDeliveries,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      deliveries: z.array(ScheduledTaskDeliveryRecordSchema).optional(),
      error: z.string().optional(),
    }),
  },
  countRuns: {
    channel: ScheduledTaskIpc.CountRuns,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      count: z.number().optional(),
      error: z.string().optional(),
    }),
  },
  listAllRuns: {
    channel: ScheduledTaskIpc.ListAllRuns,
    args: z.tuple([z.number().optional(), z.number().optional(), RunFilterSchema.optional()]),
    result: z.object({
      success: z.boolean(),
      runs: z.array(ScheduledTaskRunWithNameSchema).optional(),
      error: z.string().optional(),
    }),
  },
  resolveSession: {
    channel: ScheduledTaskIpc.ResolveSession,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      session: z.unknown().nullable().optional(),
      error: z.string().optional(),
    }),
  },
  listChannels: {
    channel: ScheduledTaskIpc.ListChannels,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      channels: z.array(ScheduledTaskChannelOptionSchema).optional(),
      error: z.string().optional(),
    }),
  },
  listChannelConversations: {
    channel: ScheduledTaskIpc.ListChannelConversations,
    args: z.tuple([z.string(), z.string().optional(), z.string().optional()]),
    result: z.object({
      success: z.boolean(),
      conversations: z.array(ScheduledTaskConversationOptionSchema).optional(),
      error: z.string().optional(),
    }),
  },
});

/** Activity feed: read-only projection of channel/scheduled-task runs. */
export const activityContract = defineIpcContract({
  list: {
    channel: ActivityIpc.List,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      runs: z.array(
        z.object({
          id: z.string(),
          source: z.enum([ActivitySource.Channel, ActivitySource.ScheduledTask]),
          status: z.enum([ActivityStatus.Running, ActivityStatus.Completed, ActivityStatus.Failed]),
          startedAt: z.number(),
          updatedAt: z.number(),
          sessionId: z.string().optional(),
          platform: z.string().optional(),
          conversationId: z.string().optional(),
          taskName: z.string().optional(),
          inputPreview: z.string().optional(),
          replyPreview: z.string().optional(),
          errorMessage: z.string().optional(),
        }),
      ),
    }),
  },
});
