/**
 * Memory IPC contracts (channel + args + result), single source of truth for
 * `registerMemoryIpcHandlers`, the `memory` preload namespace, and the renderer
 * `MemoryApi` types.
 *
 * Arg/result shapes mirror the shared memory types
 * (`src/shared/memory/types.ts`); the schemas document the fields the renderer
 * sends and reads (results are not stripped at runtime).
 */
import { z } from 'zod';

import { defineIpcContract } from './contract';
import {
  MemoryDeliveryStatus,
  MemoryIpcChannel,
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  MemorySourceKind,
  MemorySummaryFormat,
} from '../memory/constants';

const MemoryScopeSchema = z.enum([MemoryScope.Project, MemoryScope.Personal, MemoryScope.Session]);

const MemoryKindSchema = z.enum([
  MemoryKind.Decision,
  MemoryKind.Preference,
  MemoryKind.SessionSummary,
]);

/** Manual curation only accepts decision/preference kinds (shared type union). */
const ManualMemoryKindSchema = z.enum([MemoryKind.Decision, MemoryKind.Preference]);

const MemorySensitivitySchema = z.enum([MemorySensitivity.Normal, MemorySensitivity.Sensitive]);

const MemorySummaryFormatSchema = z.enum([
  MemorySummaryFormat.Semantic,
  MemorySummaryFormat.Legacy,
]);

const MemoryLifecycleStatusSchema = z.enum([
  MemoryLifecycleStatus.Active,
  MemoryLifecycleStatus.NeedsReview,
  MemoryLifecycleStatus.Superseded,
  MemoryLifecycleStatus.Expired,
  MemoryLifecycleStatus.Archived,
  MemoryLifecycleStatus.Deleted,
]);

const MemorySourceKindSchema = z.enum([
  MemorySourceKind.Explicit,
  MemorySourceKind.SessionSummary,
  MemorySourceKind.TaskVerifier,
  MemorySourceKind.ModelProposal,
  MemorySourceKind.LegacyFileImport,
  MemorySourceKind.LegacySqliteImport,
]);

/** `ManagedMemoryRecord` projection the memory settings view renders. */
const ManagedMemoryRecordSchema = z.object({
  id: z.string(),
  memoryId: z.number().nullable(),
  projectId: z.string(),
  scope: MemoryScopeSchema,
  sessionId: z.string(),
  sourceKind: MemorySourceKindSchema,
  taskId: z.string().nullable(),
  runId: z.string().nullable(),
  artifactId: z.string().nullable(),
  approvalId: z.string().nullable(),
  status: MemoryLifecycleStatusSchema,
  title: z.string(),
  content: z.string(),
  kind: MemoryKindSchema,
  topicKey: z.string().nullable(),
  importance: z.number(),
  confidence: z.number(),
  sensitivity: MemorySensitivitySchema,
  expiresAt: z.string().nullable(),
  supersededBy: z.string().nullable(),
  promotedFromLinkId: z.string().nullable(),
  promotionSourceProjectId: z.string().nullable(),
  promotionSourceSessionId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deliveryStatus: z
    .enum([
      MemoryDeliveryStatus.Pending,
      MemoryDeliveryStatus.Completed,
      MemoryDeliveryStatus.Failed,
    ])
    .nullable(),
  deliveryError: z.string().nullable(),
  summaryFormat: MemorySummaryFormatSchema.nullable().optional(),
});

const MemorySessionTitleSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
});

/** `{ success, data?, error? }` envelope every memory IPC call returns. */
function memoryResultSchema<T extends z.ZodType>(data: T) {
  return z.object({
    success: z.boolean(),
    data: data.optional(),
    error: z.string().optional(),
  });
}

const ManagedMemoryListInputSchema = z.object({
  workingDirectory: z.string().optional(),
  scope: MemoryScopeSchema.optional(),
  status: MemoryLifecycleStatusSchema.optional(),
  query: z.string().optional(),
});

const ManualMemoryCreateInputSchema = z.object({
  workingDirectory: z.string(),
  scope: z.enum([MemoryScope.Project, MemoryScope.Personal]),
  title: z.string(),
  content: z.string(),
  kind: ManualMemoryKindSchema,
  sensitivity: MemorySensitivitySchema,
});

const ManualMemoryUpdateInputSchema = z.object({
  id: z.string(),
  workingDirectory: z.string(),
  title: z.string(),
  content: z.string(),
  kind: ManualMemoryKindSchema,
  sensitivity: MemorySensitivitySchema,
});

export const memoryContract = defineIpcContract({
  list: {
    channel: MemoryIpcChannel.List,
    args: z.tuple([ManagedMemoryListInputSchema.optional()]),
    result: memoryResultSchema(z.array(ManagedMemoryRecordSchema)),
  },
  resolveSessionTitles: {
    channel: MemoryIpcChannel.ResolveSessionTitles,
    args: z.tuple([z.object({ sessionIds: z.array(z.string()) }).optional()]),
    result: memoryResultSchema(z.array(MemorySessionTitleSchema)),
  },
  createManual: {
    channel: MemoryIpcChannel.CreateManual,
    args: z.tuple([ManualMemoryCreateInputSchema]),
    result: memoryResultSchema(ManagedMemoryRecordSchema),
  },
  updateManual: {
    channel: MemoryIpcChannel.UpdateManual,
    args: z.tuple([ManualMemoryUpdateInputSchema]),
    result: memoryResultSchema(ManagedMemoryRecordSchema),
  },
  confirmCandidate: {
    channel: MemoryIpcChannel.ConfirmCandidate,
    args: z.tuple([z.string()]),
    result: memoryResultSchema(z.number().nullable()),
  },
  archive: {
    channel: MemoryIpcChannel.Archive,
    args: z.tuple([z.string()]),
    result: memoryResultSchema(z.void()),
  },
  restore: {
    channel: MemoryIpcChannel.Restore,
    args: z.tuple([z.string()]),
    result: memoryResultSchema(z.void()),
  },
  forget: {
    channel: MemoryIpcChannel.Forget,
    args: z.tuple([z.string(), z.boolean()]),
    result: memoryResultSchema(z.boolean()),
  },
  drainOutbox: {
    channel: MemoryIpcChannel.DrainOutbox,
    args: z.tuple([]),
    result: memoryResultSchema(z.number()),
  },
});
