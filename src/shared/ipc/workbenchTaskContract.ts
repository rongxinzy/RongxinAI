/**
 * Read-only workbench task projection IPC contracts (channel + args + result).
 */
import { z } from 'zod';

import { defineIpcContract } from './contract';
import { WorkbenchTaskIpc } from '../workbenchTask';

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
});
