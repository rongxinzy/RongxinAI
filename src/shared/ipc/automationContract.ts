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

const ScheduledTaskDeliverySchema = z.strictObject({ mode: z.literal(DeliveryMode.None) });

/** Shape the task form submits (buildTaskInput in taskFormState.ts). */
const ScheduledTaskInputSchema = z.object({
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  schedule: ScheduleSchema,
  sessionTarget: z.enum([SessionTarget.Isolated, SessionTarget.Task]),
  wakeMode: z.literal(WakeMode.Now),
  payload: ScheduledTaskPayloadSchema,
  delivery: ScheduledTaskDeliverySchema.optional(),
  workspaceId: z.string().nullable().optional(),
  sessionKey: z.null().optional(),
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

/** `ScheduledTask` row as returned by the durable automation service. */
const ScheduledTaskSchema = ScheduledTaskInputSchema.extend({
  id: z.string(),
  workspaceId: z.string().nullable(),
  sessionKey: z.null(),
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
    // Handler reports whether an active run was stopped.
    result: z.object({
      success: z.boolean(),
      result: z.boolean().optional(),
      error: z.string().optional(),
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
});

/** Activity feed: read-only projection of local automation runs. */
export const activityContract = defineIpcContract({
  list: {
    channel: ActivityIpc.List,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      runs: z.array(
        z.object({
          id: z.string(),
          source: z.enum(ActivitySource),
          status: z.enum([ActivityStatus.Running, ActivityStatus.Completed, ActivityStatus.Failed]),
          startedAt: z.number(),
          updatedAt: z.number(),
          sessionId: z.string().optional(),
          taskName: z.string().optional(),
          inputPreview: z.string().optional(),
          replyPreview: z.string().optional(),
          errorMessage: z.string().optional(),
        }),
      ),
    }),
  },
});
