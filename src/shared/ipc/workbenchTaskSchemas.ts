/**
 * Workbench task IPC zod schemas shared by the contract and the main-side
 * handler. Split from `workbenchTaskContract.ts` so the shared
 * `WorkbenchTaskResumeInput` type stays the single owner of the resume shape
 * and the schema only re-pins the argument envelope.
 */
import { z } from 'zod';

/** Approval decision payload (WorkbenchApprovalResponseInput). */
export const WorkbenchApprovalResponseInputSchema = z.object({
  approvalId: z.string().min(1),
  approved: z.boolean(),
  reason: z.string().optional(),
});

/** Resume payload (WorkbenchTaskResumeInput): taskId plus optional context. */
export const WorkbenchTaskResumeInputSchema = z.object({
  taskId: z.string().min(1),
  amendment: z.string().optional(),
  skillIds: z.array(z.string()).optional(),
  expertIds: z.array(z.string()).optional(),
  goalMode: z.boolean().optional(),
  imageAttachments: z
    .array(
      z.object({
        name: z.string(),
        mimeType: z.string(),
        base64Data: z.string(),
      }),
    )
    .optional(),
  fileAttachments: z
    .array(
      z.object({
        name: z.string(),
        path: z.string(),
        extension: z.string(),
      }),
    )
    .optional(),
});
