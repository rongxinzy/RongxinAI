/**
 * Cowork IPC contracts (channel + args + result), single source of truth for
 * the `cowork` preload namespace, its `appBootstrap/*Ipc` handlers, and the
 * renderer `CoworkApi` types.
 *
 * Arg schemas mirror what the renderer sends today
 * (`src/renderer/services/cowork.ts`, `coworkQueue.ts`, `workspace.ts`).
 * `startSession` / `continueSession` / `updateSessionModel` previously parsed
 * with `schemas.ts` inputs — the same objects (including the
 * `hasCoworkSubmissionContent` refine and the path-stripping image schema)
 * are reused verbatim through the contract so validation semantics do not
 * change. Queue payloads reuse `queueSchemas.ts` the same way.
 *
 * The contract is composed of per-file sub-contracts because main registers
 * handlers across several `appBootstrap` modules; each module passes its own
 * sub-contract to `handleIpcContract`. `coworkContract` (the union of all
 * sub-contracts) is what the preload channel map and renderer types derive
 * from.
 */
import { z } from 'zod';

import { defineIpcContract } from './contract';
import {
  CoworkConfigIpc,
  CoworkPermissionIpc,
  CoworkQueueIpc,
  CoworkSessionIpc,
  CoworkStreamIpc,
} from './channels';
import {
  CoworkQueueEnqueueSchema,
  CoworkQueueItemSchema,
  CoworkQueueSessionSchema,
  CoworkQueueUpdateSchema,
} from './queueSchemas';
import {
  CoworkConfigSetSchema,
  CoworkSessionContinueSchema,
  CoworkSessionStartSchema,
  CoworkSessionUpdateModelSchema,
} from './schemas';
import {
  CoworkArtifactRole,
  CoworkArtifactSource,
  type CoworkArtifactType,
} from '../cowork/artifacts';
import {
  CoworkCompactFailure,
  CoworkExecutionMode,
  CoworkPermissionMode,
  CoworkSessionMode,
  CoworkSessionSource,
  CoworkSessionStatus,
} from '../cowork/constants';
import { CoworkRunPhase } from '../cowork/runState';
import { WorkspaceIpc } from '../workspace';
import { CoworkQueueDelivery, CoworkQueueItemStatus } from '../cowork/pendingMessageQueue';
import { CoworkSessionExpertSource } from '../cowork/sessionExperts';

/** Message row as slimmed/sanitized for IPC by the main process. */
const CoworkMessageSchema = z.object({
  id: z.string(),
  type: z.enum(['user', 'assistant', 'tool_use', 'tool_result', 'system']),
  content: z.string(),
  timestamp: z.number(),
  sequence: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Ledger row (`CoworkPersistedArtifact`) aggregated onto sessions by main. */
const CoworkPersistedArtifactSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  toolCallId: z.string().nullable().optional(),
  runId: z.string().nullable().optional(),
  type: z.string() as z.ZodType<CoworkArtifactType>,
  title: z.string(),
  content: z.string(),
  language: z.string().optional(),
  fileName: z.string().optional(),
  filePath: z.string().optional(),
  source: z.enum(CoworkArtifactSource),
  role: z.enum(CoworkArtifactRole),
  declared: z.boolean(),
  createdAt: z.number(),
});

const CoworkSessionExpertSchema = z.object({
  expertId: z.string(),
  packageId: z.string(),
  expertName: z.string(),
  source: z.enum([
    CoworkSessionExpertSource.Package,
    CoworkSessionExpertSource.Member,
    CoworkSessionExpertSource.Custom,
  ]),
  promptSnapshot: z.string(),
  skillIds: z.array(z.string()),
  capabilityPolicy: z.record(z.string(), z.unknown()),
  contentHash: z.string(),
  createdAt: z.number(),
});

const CoworkSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(CoworkSessionStatus),
  mode: z.enum([CoworkSessionMode.Work, CoworkSessionMode.Chat]).optional(),
  pinned: z.boolean(),
  pinOrder: z.number().nullable().optional(),
  cwd: z.string(),
  systemPrompt: z.string(),
  modelOverride: z.string(),
  executionMode: z.enum(CoworkExecutionMode),
  activeSkillIds: z.array(z.string()),
  workspaceId: z.string(),
  agentId: z.string(),
  source: z.enum(CoworkSessionSource),
  experts: z.array(CoworkSessionExpertSchema).optional(),
  messages: z.array(CoworkMessageSchema),
  messagesOffset: z.number(),
  totalMessages: z.number(),
  /** Ledger artifacts of the whole session (not limited to the loaded page). */
  artifacts: z.array(CoworkPersistedArtifactSchema).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** Session summary rows carry only list-visible fields. */
const CoworkSessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(CoworkSessionStatus),
  mode: z.enum([CoworkSessionMode.Work, CoworkSessionMode.Chat]).optional(),
  pinned: z.boolean(),
  pinOrder: z.number().nullable().optional(),
  workspaceId: z.string().optional(),
  agentId: z.string().optional(),
  source: z.enum(CoworkSessionSource),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const CoworkRunSnapshotSchema = z.object({
  sessionId: z.string(),
  runId: z.string(),
  sequence: z.number(),
  phase: z.enum(CoworkRunPhase),
  running: z.boolean(),
  startedAt: z.number(),
  confirmedAt: z.number(),
  lastProgressAt: z.number(),
  toolName: z.string().optional(),
  toolStartedAt: z.number().optional(),
  preview: z.string().optional(),
  retryAttempt: z.number().optional(),
  retryAt: z.number().optional(),
});

/** Pi UI runtime snapshot (`PiUiRuntimeSnapshots.read`). */
const PiUiRuntimeSnapshotSchema = z.object({
  sessionId: z.string(),
  sequence: z.number(),
  status: z.enum(CoworkSessionStatus),
});

/**
 * Queued item as slimmed by `slimQueuedMessagesForIpc`. Inline (not yet
 * persisted) images carry `base64Data` with an empty `path`; stored ones carry
 * a real `path` and no payload — mirroring `CoworkQueuedImageAttachment`.
 */
const CoworkPendingMessageSchema = z.object({
  id: z.string(),
  text: z.string(),
  delivery: z.enum(CoworkQueueDelivery),
  createdAt: z.number(),
  status: z.enum(CoworkQueueItemStatus),
  imageAttachments: z
    .array(
      z.object({
        name: z.string(),
        mimeType: z.string(),
        path: z.string().optional(),
        base64Data: z.string().optional(),
      }),
    )
    .optional(),
  fileAttachments: z
    .array(
      z.object({
        name: z.string(),
        path: z.string(),
        extension: z.string(),
        isImage: z.boolean().optional(),
      }),
    )
    .optional(),
  skillIds: z.array(z.string()).optional(),
  error: z.string().optional(),
});

const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  folders: z.array(z.string()).optional(),
  isHidden: z.boolean(),
  pinned: z.boolean().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** Pi permission decision forwarded to the runtime (`PiPermissionResult`). */
const CoworkPermissionResultSchema = z.discriminatedUnion('behavior', [
  z.object({
    behavior: z.literal('allow'),
    updatedInput: z.record(z.string(), z.unknown()).optional(),
    updatedPermissions: z.array(z.record(z.string(), z.unknown())).optional(),
    toolUseID: z.string().optional(),
  }),
  z.object({
    behavior: z.literal('deny'),
    message: z.string(),
    interrupt: z.boolean().optional(),
    toolUseID: z.string().optional(),
  }),
]);

const CaptureRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

/**
 * Streaming methods, registered in two files: `coworkRunBridge.ts` owns the
 * run snapshot read, `piUiForwarder.ts` owns the runtime snapshot read and
 * renderer-initiated resync. Exported per-file so each module registers only
 * what it owns; the union is composed into `coworkContract` below.
 */
export const coworkRunSnapshotContract = defineIpcContract({
  getRunSnapshot: {
    channel: CoworkSessionIpc.RunSnapshot,
    args: z.tuple([z.string()]),
    // Oversized ids (>200 chars) short-circuit to `{ success: false }` with no
    // snapshot fields; the renderer only checks `success` on that path.
    result: z.object({
      success: z.boolean(),
      snapshot: CoworkRunSnapshotSchema.nullable().optional(),
      running: z.boolean().optional(),
    }),
  },
});

export const coworkPiStreamContract = defineIpcContract({
  getRuntimeSnapshots: {
    channel: CoworkStreamIpc.RuntimeSnapshots,
    args: z.tuple([z.string().optional()]),
    result: z.array(PiUiRuntimeSnapshotSchema),
  },
  requestStreamResync: {
    channel: CoworkStreamIpc.StreamResync,
    // Empty ids have nothing to reseed; main treated them as a no-op false
    // before the contract, min(1) keeps that boundary.
    args: z.tuple([z.string().min(1)]),
    result: z.boolean(),
  },
});

/** Registered by `workspaceIpc.ts`. */
export const workspaceContract = defineIpcContract({
  listWorkspaces: {
    channel: WorkspaceIpc.List,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      workspaces: z.array(WorkspaceSchema).optional(),
      error: z.string().optional(),
    }),
  },
  createWorkspace: {
    channel: WorkspaceIpc.Create,
    args: z.tuple([z.object({ path: z.string(), name: z.string() })]),
    result: z.object({
      success: z.boolean(),
      workspace: WorkspaceSchema.optional(),
      error: z.string().optional(),
    }),
  },
  ensureWorkspace: {
    channel: WorkspaceIpc.Ensure,
    args: z.tuple([
      z.object({
        path: z.string(),
        name: z.string().optional(),
        isHidden: z.boolean().optional(),
      }),
    ]),
    result: z.object({
      success: z.boolean(),
      workspace: WorkspaceSchema.optional(),
      error: z.string().optional(),
    }),
  },
  renameWorkspace: {
    channel: WorkspaceIpc.Rename,
    args: z.tuple([z.string(), z.string()]),
    result: z.object({
      success: z.boolean(),
      workspace: WorkspaceSchema.optional(),
      error: z.string().optional(),
    }),
  },
  updateWorkspace: {
    channel: WorkspaceIpc.Update,
    args: z.tuple([
      z.object({
        id: z.string(),
        name: z.string().optional(),
        primaryPath: z.string().optional(),
        folders: z.array(z.string()).optional(),
      }),
    ]),
    result: z.object({
      success: z.boolean(),
      workspace: WorkspaceSchema.optional(),
      error: z.string().optional(),
    }),
  },
  deleteWorkspace: {
    channel: WorkspaceIpc.Delete,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      deletedSessionIds: z.array(z.string()).optional(),
      error: z.string().optional(),
    }),
  },
});

/** Registered by `coworkSessionIpc.ts`. */
export const coworkSessionLifecycleContract = defineIpcContract({
  startSession: {
    channel: CoworkSessionIpc.Start,
    args: z.tuple([CoworkSessionStartSchema.input]),
    result: z.object({
      success: z.boolean(),
      session: CoworkSessionSchema.optional(),
      error: z.string().optional(),
      code: z.string().optional(),
    }),
  },
  continueSession: {
    channel: CoworkSessionIpc.Continue,
    args: z.tuple([CoworkSessionContinueSchema.input]),
    result: z.object({
      success: z.boolean(),
      session: CoworkSessionSchema.nullable().optional(),
      error: z.string().optional(),
      code: z.string().optional(),
    }),
  },
});

/** Registered by `coworkSessionAdminIpc.ts`. */
export const coworkSessionAdminContract = defineIpcContract({
  stopSession: {
    channel: CoworkSessionIpc.Stop,
    args: z.tuple([z.string()]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  compactSession: {
    channel: CoworkSessionIpc.Compact,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      queued: z.boolean().optional(),
      cancelled: z.boolean().optional(),
      reason: z.enum(CoworkCompactFailure).optional(),
    }),
  },
  saveSession: {
    // Imported transcript row sent by `saveChatSession` (the whole renderer
    // CoworkSession). Pin the fields the impl consumes; the renderer may send
    // additional row fields which main stores verbatim.
    channel: CoworkSessionIpc.Save,
    args: z.tuple([
      z
        .object({
          id: z.string(),
          title: z.string(),
          status: z.string(),
          mode: z.enum([CoworkSessionMode.Work, CoworkSessionMode.Chat]),
          cwd: z.string(),
          systemPrompt: z.string(),
          modelOverride: z.string(),
          executionMode: z.string(),
          activeSkillIds: z.array(z.string()),
          agentId: z.string(),
          messages: z
            .array(
              z.object({
                id: z.string(),
                type: z.string(),
                content: z.string(),
                timestamp: z.number(),
                metadata: z.record(z.string(), z.unknown()).optional(),
              }),
            )
            .optional(),
        })
        .passthrough(),
    ]),
    result: z.object({
      success: z.boolean(),
      session: CoworkSessionSchema.nullable().optional(),
      error: z.string().optional(),
    }),
  },
  deleteSession: {
    channel: CoworkSessionIpc.Delete,
    args: z.tuple([z.string()]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  deleteSessions: {
    channel: CoworkSessionIpc.DeleteBatch,
    args: z.tuple([z.array(z.string())]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  setSessionPinned: {
    channel: CoworkSessionIpc.Pin,
    args: z.tuple([z.object({ sessionId: z.string(), pinned: z.boolean() })]),
    result: z.object({
      success: z.boolean(),
      pinOrder: z.number().nullable().optional(),
      error: z.string().optional(),
    }),
  },
  renameSession: {
    channel: CoworkSessionIpc.Rename,
    args: z.tuple([z.object({ sessionId: z.string(), title: z.string() })]),
    result: z.object({
      success: z.boolean(),
      title: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  updateSessionModel: {
    channel: CoworkSessionIpc.UpdateModel,
    args: z.tuple([CoworkSessionUpdateModelSchema.input]),
    result: z.object({
      success: z.boolean(),
      session: CoworkSessionSchema.nullable().optional(),
      error: z.string().optional(),
    }),
  },
  getSession: {
    channel: CoworkSessionIpc.Get,
    args: z.tuple([
      z.string(),
      z.object({ messageLimit: z.number().nullable().optional() }).optional(),
    ]),
    result: z.object({
      success: z.boolean(),
      session: CoworkSessionSchema.nullable().optional(),
      error: z.string().optional(),
    }),
  },
  remoteManaged: {
    channel: CoworkSessionIpc.RemoteManaged,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      remoteManaged: z.boolean(),
      error: z.string().optional(),
    }),
  },
  listSessions: {
    channel: CoworkSessionIpc.List,
    args: z.tuple([
      z
        .object({
          limit: z.number().optional(),
          offset: z.number().optional(),
          agentId: z.string().optional(),
          workspaceId: z.string().optional(),
          mode: z.enum([CoworkSessionMode.Work, CoworkSessionMode.Chat]).optional(),
          sources: z.array(z.enum(CoworkSessionSource)).optional(),
        })
        .optional(),
    ]),
    result: z.object({
      success: z.boolean(),
      sessions: z.array(CoworkSessionSummarySchema).optional(),
      hasMore: z.boolean().optional(),
      error: z.string().optional(),
    }),
  },
  getSessionMessages: {
    channel: CoworkSessionIpc.GetMessages,
    args: z.tuple([
      z.object({
        sessionId: z.string(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      }),
    ]),
    result: z.object({
      success: z.boolean(),
      messages: z.array(CoworkMessageSchema).optional(),
      offset: z.number().optional(),
      total: z.number().optional(),
      error: z.string().optional(),
    }),
  },
});

/** Registered by `coworkExportIpc.ts`. */
export const coworkExportContract = defineIpcContract({
  exportResultImage: {
    channel: CoworkSessionIpc.ExportResultImage,
    args: z.tuple([z.object({ rect: CaptureRectSchema, defaultFileName: z.string().optional() })]),
    result: z.object({
      success: z.boolean(),
      canceled: z.boolean().optional(),
      path: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  captureImageChunk: {
    channel: CoworkSessionIpc.CaptureImageChunk,
    args: z.tuple([z.object({ rect: CaptureRectSchema })]),
    result: z.object({
      success: z.boolean(),
      width: z.number().optional(),
      height: z.number().optional(),
      pngBase64: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  saveResultImage: {
    channel: CoworkSessionIpc.SaveResultImage,
    args: z.tuple([z.object({ pngBase64: z.string(), defaultFileName: z.string().optional() })]),
    result: z.object({
      success: z.boolean(),
      canceled: z.boolean().optional(),
      path: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  exportSessionText: {
    channel: CoworkSessionIpc.ExportText,
    args: z.tuple([
      z.object({
        content: z.string(),
        defaultFileName: z.string().optional(),
        fileExtension: z.string().optional(),
      }),
    ]),
    result: z.object({
      success: z.boolean(),
      canceled: z.boolean().optional(),
      path: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  respondToPermission: {
    channel: CoworkPermissionIpc.Respond,
    args: z.tuple([z.object({ requestId: z.string(), result: CoworkPermissionResultSchema })]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
});

/** Registered by `coworkQueueIpc.ts`. */
export const coworkQueueContract = defineIpcContract({
  listPendingMessages: {
    channel: CoworkQueueIpc.List,
    args: z.tuple([CoworkQueueSessionSchema]),
    result: z.object({
      success: z.boolean(),
      items: z.array(CoworkPendingMessageSchema).optional(),
      error: z.string().optional(),
    }),
  },
  enqueuePendingMessage: {
    channel: CoworkQueueIpc.Enqueue,
    args: z.tuple([CoworkQueueEnqueueSchema]),
    result: z.object({
      success: z.boolean(),
      item: CoworkPendingMessageSchema.optional(),
      error: z.string().optional(),
    }),
  },
  updatePendingMessage: {
    channel: CoworkQueueIpc.Update,
    args: z.tuple([CoworkQueueUpdateSchema]),
    result: z.object({
      success: z.boolean(),
      item: CoworkPendingMessageSchema.optional(),
      error: z.string().optional(),
    }),
  },
  deletePendingMessage: {
    channel: CoworkQueueIpc.Delete,
    args: z.tuple([CoworkQueueItemSchema]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  steerPendingMessage: {
    channel: CoworkQueueIpc.Steer,
    args: z.tuple([CoworkQueueItemSchema]),
    result: z.object({
      success: z.boolean(),
      item: CoworkPendingMessageSchema.optional(),
      error: z.string().optional(),
    }),
  },
  followUpPendingMessage: {
    channel: CoworkQueueIpc.FollowUp,
    args: z.tuple([CoworkQueueItemSchema]),
    result: z.object({
      success: z.boolean(),
      item: CoworkPendingMessageSchema.optional(),
      error: z.string().optional(),
    }),
  },
});

/** Full config row returned by `getConfig`; mirrors main's `CoworkConfig`. */
const CoworkConfigSchema = z.object({
  workingDirectory: z.string(),
  systemPrompt: z.string(),
  executionMode: z.enum(CoworkExecutionMode),
  permissionMode: z.enum([CoworkPermissionMode.Ask, CoworkPermissionMode.AllowAll]),
  permissionModeBySession: z.record(
    z.string(),
    z.enum([CoworkPermissionMode.Ask, CoworkPermissionMode.AllowAll]),
  ),
  embeddingEnabled: z.boolean(),
  embeddingProvider: z.string(),
  embeddingModel: z.string(),
  embeddingLocalModelPath: z.string(),
  embeddingVectorWeight: z.number(),
  embeddingRemoteBaseUrl: z.string(),
  embeddingRemoteApiKey: z.string(),
  codemodeEnabled: z.boolean(),
  mcpNativeBridge: z.boolean(),
});

/** Registered by `coworkConfigIpc.ts`. */
export const coworkConfigContract = defineIpcContract({
  getConfig: {
    channel: CoworkConfigIpc.Get,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      config: CoworkConfigSchema.optional(),
      error: z.string().optional(),
    }),
  },
  setConfig: {
    // `permissionMode`/`permissionModeBySession` are sent by the renderer
    // (deleteSession cleanup, chat-skill auto-allow) even though the legacy
    // `CoworkConfigSetSchema` omits them; the impl normalizes both, so keep
    // accepting exactly what callers send.
    channel: CoworkConfigIpc.Set,
    args: z.tuple([
      CoworkConfigSetSchema.input.extend({
        permissionMode: z
          .enum([CoworkPermissionMode.Ask, CoworkPermissionMode.AllowAll])
          .optional(),
        permissionModeBySession: z
          .record(z.string(), z.enum([CoworkPermissionMode.Ask, CoworkPermissionMode.AllowAll]))
          .optional(),
      }),
    ]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
});

/**
 * Full cowork contract: every invoke method of the `cowork` preload
 * namespace. Derived from the per-file sub-contracts so the channel map and
 * renderer types cannot drift from what main actually registers.
 */
export const coworkContract = defineIpcContract({
  ...coworkRunSnapshotContract,
  ...coworkPiStreamContract,
  ...workspaceContract,
  ...coworkSessionLifecycleContract,
  ...coworkSessionAdminContract,
  ...coworkExportContract,
  ...coworkQueueContract,
  ...coworkConfigContract,
});
