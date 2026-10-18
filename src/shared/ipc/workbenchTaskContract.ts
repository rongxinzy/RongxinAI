/**
 * Workbench task IPC contracts (channel + args + result), single source of
 * truth for `src/main/workbenchTask/ipc.ts` handlers, the `workbenchTask`
 * preload namespace, and the renderer `WorkbenchTaskApi` types.
 *
 * Results are main-owned `WorkbenchTaskDetail` projections; the schemas pin
 * only the envelope fields, with the detail cast to the shared type.
 */
import { z } from 'zod';

import { defineIpcContract } from './contract';
import { WorkbenchTaskIpc } from '../workbenchTask';
import {
  WorkbenchApprovalResponseInputSchema,
  WorkbenchTaskResumeInputSchema,
} from './workbenchTaskSchemas';

/** Detail rows are owned by the task service; the result only pins the envelope. */
const ActionResultSchema = z.object({
  success: z.boolean(),
  detail: z.unknown().optional(),
  error: z.string().optional(),
});

export const workbenchTaskContract = defineIpcContract({
  getCurrent: {
    channel: WorkbenchTaskIpc.GetCurrent,
    args: z.tuple([z.string()]),
    result: ActionResultSchema,
  },
  getDetail: {
    channel: WorkbenchTaskIpc.GetDetail,
    args: z.tuple([z.string()]),
    result: ActionResultSchema,
  },
  listForSession: {
    channel: WorkbenchTaskIpc.ListForSession,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      tasks: z.array(z.unknown()).optional(),
      error: z.string().optional(),
    }),
  },
  exportAudit: {
    channel: WorkbenchTaskIpc.ExportAudit,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      canceled: z.boolean().optional(),
      path: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  resume: {
    channel: WorkbenchTaskIpc.Resume,
    args: z.tuple([WorkbenchTaskResumeInputSchema]),
    result: ActionResultSchema,
  },
  retry: {
    channel: WorkbenchTaskIpc.Retry,
    args: z.tuple([z.string()]),
    result: ActionResultSchema,
  },
  accept: {
    channel: WorkbenchTaskIpc.Accept,
    args: z.tuple([z.string()]),
    result: ActionResultSchema,
  },
  respondToApproval: {
    channel: WorkbenchTaskIpc.RespondToApproval,
    args: z.tuple([WorkbenchApprovalResponseInputSchema]),
    result: ActionResultSchema,
  },
});
