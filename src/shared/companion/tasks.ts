import { z } from 'zod';
import { WorkbenchRunStatus } from '../workbenchTask/constants';
import { CompanionUnavailableReason } from './constants';

export const companionTaskRequest = z
  .object({
    petId: z.uuid(),
    requestId: z.string().trim().min(1).max(128),
    text: z.string().trim().min(1).max(32_000),
    workspaceId: z.string().min(1).max(128),
  })
  .strict();
const companionTaskReceipt = z
  .object({
    petId: z.uuid(),
    requestId: z.string(),
    sessionId: z.uuid(),
    taskId: z.uuid(),
    runId: z.uuid(),
  })
  .strict();
export const companionTaskProjection = z.object({
  receipt: companionTaskReceipt,
  title: z.string(),
  status: z.enum(Object.values(WorkbenchRunStatus)),
  missing: z.boolean(),
});
export const companionTaskResult = z.object({
  receipt: companionTaskReceipt.nullable(),
  reason: z.enum(Object.values(CompanionUnavailableReason)).optional(),
});
export const companionWorkspace = z.object({ id: z.string(), name: z.string() });
export type CompanionTaskRequest = z.infer<typeof companionTaskRequest>;
export type CompanionTaskReceipt = z.infer<typeof companionTaskReceipt>;
export type CompanionTaskProjection = z.infer<typeof companionTaskProjection>;
export type CompanionTaskResult = z.infer<typeof companionTaskResult>;
export type CompanionWorkspace = z.infer<typeof companionWorkspace>;
