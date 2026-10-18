/**
 * Coding agent IPC contracts (channel + args + result), single source of truth
 * for `registerCodingAgentIpcHandlers`, the `codingAgent` preload namespace,
 * and the renderer `CodingAgentApi` types.
 *
 * Arg schemas mirror the shared input types (`src/shared/codingAgent/types.ts`)
 * the renderer hooks send; every method wraps its payload in a
 * `{ workspaceRoot, ... }` object except the few that take a bare string.
 * Result envelopes document the fields the renderer reads (snapshots are kept
 * opaque via `passthrough`-free unknown projections — results are not
 * validated in production).
 */
import { z } from 'zod';

import { defineIpcContract } from './contract';
import {
  CodingAgentIpc,
  CodingGitFileStatus,
  CodingPermissionOutcome,
} from '../codingAgent/constants';
import { CoworkQueueDelivery } from '../cowork/pendingMessageQueue';

const WorkspaceRootSchema = z.string();

const LaneRefSchema = z.object({ workspaceRoot: WorkspaceRootSchema, laneId: z.string() });

const CodingProfileCapabilitiesSchema = z.object({
  supportsLoadSession: z.boolean(),
  supportsResumeSession: z.boolean(),
  supportsPlans: z.boolean(),
  supportsPermissions: z.boolean(),
  supportsFilesystem: z.boolean(),
  supportsTerminal: z.boolean(),
  supportsConfigOptions: z.boolean(),
  supportsUsage: z.boolean(),
  supportsElicitation: z.boolean(),
  supportsPromptImages: z.boolean().optional(),
  supportsEmbeddedContext: z.boolean().optional(),
});

/** `CodingAgentProfile` as advertised by the profile manager. */
const CodingAgentProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  driverKind: z.string(),
  status: z.string(),
  capabilities: CodingProfileCapabilitiesSchema,
  authMethods: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      type: z.string().optional(),
      args: z.array(z.string()).optional(),
      environment: z.record(z.string(), z.string()).optional(),
    }),
  ),
  command: z.string().nullable(),
  args: z.array(z.string()),
  environment: z.record(z.string(), z.string()),
  isBuiltin: z.boolean(),
  connectionCheck: z
    .object({
      phase: z.string(),
      failure: z.string().optional(),
      checkedAt: z.number().optional(),
    })
    .optional(),
});

const CodingWorkspaceSourceSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  path: z.string(),
  isPrimary: z.boolean(),
});

const CodingSessionSummarySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  missionId: z.string(),
  parentSessionId: z.string().nullable(),
  title: z.string(),
  profileId: z.string(),
  sourceRoot: z.string(),
  status: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const CodingWorkspaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  primaryRoot: z.string(),
  defaultProfileId: z.string(),
  sources: z.array(CodingWorkspaceSourceSchema),
  sessions: z.array(CodingSessionSummarySchema),
  activeSessionId: z.string().nullable(),
});

const CodingConfigOptionValueSchema = z.object({
  value: z.string(),
  name: z.string(),
  description: z.string().optional(),
});

const CodingAgentConfigOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  type: z.enum(['select', 'boolean']),
  currentValue: z.union([z.string(), z.boolean()]),
  options: z.array(CodingConfigOptionValueSchema).optional(),
});

const CodingAvailableCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  input: z
    .object({
      hint: z.string(),
      options: z
        .array(
          z.object({
            value: z.string(),
            label: z.string(),
            description: z.string().optional(),
          }),
        )
        .optional(),
    })
    .nullable()
    .optional(),
  _meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

/**
 * `CodingRoomSnapshot` is a large nested projection owned by
 * `CodingRoomService`; the contract keeps it opaque and lets the renderer
 * types (`CodingAgentApi`) carry the precise `CodingRoomSnapshot` typing.
 */
const RoomSnapshotSchema = z.unknown();

/** `{ success, snapshot?, profiles?, error?, conflict? }` action envelope. */
const ActionResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  conflict: z.boolean().optional(),
  snapshot: RoomSnapshotSchema.optional(),
  profiles: z.array(CodingAgentProfileSchema).optional(),
});

const PendingMessageSchema = z.object({
  id: z.string(),
  text: z.string(),
  delivery: z.enum([CoworkQueueDelivery.Steer, CoworkQueueDelivery.FollowUp]),
  createdAt: z.number(),
  status: z.string(),
  imageAttachments: z.array(z.unknown()).optional(),
  fileAttachments: z.array(z.unknown()).optional(),
  skillIds: z.array(z.string()).optional(),
  error: z.string().optional(),
});

const CodingPromptAttachmentSchema = z.object({
  name: z.string(),
  path: z.string(),
});

const CodingPromptInputSchema = z.object({
  laneId: z.string(),
  prompt: z.string(),
  delivery: z.enum([CoworkQueueDelivery.Steer, CoworkQueueDelivery.FollowUp]).optional(),
  attachments: z.array(CodingPromptAttachmentSchema).optional(),
});

const CreateCodingWorkspaceInputSchema = z.object({
  name: z.string(),
  sourceFolders: z.array(z.string()),
  defaultProfileId: z.string(),
});

const CreateCodingSessionInputSchema = z.object({
  workspaceId: z.string(),
  profileId: z.string(),
  sourceRoot: z.string(),
  title: z.string().optional(),
  modelOverride: z.string().optional(),
});

const StartCodingSessionInputSchema = CreateCodingSessionInputSchema.extend({
  prompt: z.string(),
  attachments: z.array(CodingPromptAttachmentSchema).optional(),
  configOptionOverrides: z.record(z.string(), z.string()).optional(),
});

const GitTargetSchema = z.object({
  workspaceRoot: WorkspaceRootSchema,
  laneId: z.string().optional(),
  sourceRoot: z.string().optional(),
});

const GitFileStatusSchema = z.enum([
  CodingGitFileStatus.Added,
  CodingGitFileStatus.Modified,
  CodingGitFileStatus.Deleted,
  CodingGitFileStatus.Renamed,
  CodingGitFileStatus.Copied,
  CodingGitFileStatus.Untracked,
  CodingGitFileStatus.Conflicted,
  CodingGitFileStatus.TypeChanged,
]);

const GitStatusSchema = z.object({
  isRepository: z.boolean(),
  targetRoot: z.string(),
  repositoryRoot: z.string().nullable(),
  githubRepositoryUrl: z.string().nullable(),
  hasOrigin: z.boolean(),
  hasRemoteBranch: z.boolean(),
  defaultBranch: z.string().nullable(),
  branch: z.string().nullable(),
  localBranches: z.array(z.string()),
  head: z.string().nullable(),
  detached: z.boolean(),
  upstream: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),
  additions: z.number(),
  deletions: z.number(),
  files: z.array(
    z.object({
      path: z.string(),
      originalPath: z.string().optional(),
      indexStatus: GitFileStatusSchema.nullable(),
      worktreeStatus: GitFileStatusSchema.nullable(),
      additions: z.number().nullable(),
      deletions: z.number().nullable(),
    }),
  ),
  isIsolated: z.boolean(),
  isBusy: z.boolean(),
  canMutate: z.boolean(),
});

const GitStatusResultSchema = z.object({
  success: z.boolean(),
  status: GitStatusSchema.optional(),
  error: z.string().optional(),
});

const WorkspaceFileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.string(),
});

const WorkspaceFileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
  sha256: z.string(),
});

export const codingAgentContract = defineIpcContract({
  listProfiles: {
    channel: CodingAgentIpc.ListProfiles,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      profiles: z.array(CodingAgentProfileSchema).optional(),
      error: z.string().optional(),
    }),
  },
  listWorkspaces: {
    channel: CodingAgentIpc.ListWorkspaces,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      workspaces: z.array(CodingWorkspaceSummarySchema).optional(),
      error: z.string().optional(),
    }),
  },
  createWorkspace: {
    channel: CodingAgentIpc.CreateWorkspace,
    args: z.tuple([CreateCodingWorkspaceInputSchema]),
    result: z.object({
      success: z.boolean(),
      workspaces: z.array(CodingWorkspaceSummarySchema).optional(),
      error: z.string().optional(),
    }),
  },
  updateWorkspace: {
    channel: CodingAgentIpc.UpdateWorkspace,
    args: z.tuple([CreateCodingWorkspaceInputSchema.extend({ workspaceId: z.string() })]),
    result: z.object({
      success: z.boolean(),
      workspaces: z.array(CodingWorkspaceSummarySchema).optional(),
      error: z.string().optional(),
    }),
  },
  deleteWorkspace: {
    channel: CodingAgentIpc.DeleteWorkspace,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      workspaces: z.array(CodingWorkspaceSummarySchema).optional(),
      error: z.string().optional(),
    }),
  },
  deleteSession: {
    channel: CodingAgentIpc.DeleteSession,
    args: z.tuple([LaneRefSchema]),
    result: z.object({
      success: z.boolean(),
      workspaces: z.array(CodingWorkspaceSummarySchema).optional(),
      error: z.string().optional(),
    }),
  },
  getProfileConfigOptions: {
    channel: CodingAgentIpc.GetProfileConfigOptions,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      configOptions: z.array(CodingAgentConfigOptionSchema).optional(),
      error: z.string().optional(),
    }),
  },
  getProfileAvailableCommands: {
    channel: CodingAgentIpc.GetProfileAvailableCommands,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      commands: z.array(CodingAvailableCommandSchema).optional(),
      error: z.string().optional(),
    }),
  },
  createSession: {
    channel: CodingAgentIpc.CreateSession,
    args: z.tuple([CreateCodingSessionInputSchema]),
    result: ActionResultSchema,
  },
  startSession: {
    channel: CodingAgentIpc.StartSession,
    args: z.tuple([StartCodingSessionInputSchema]),
    result: ActionResultSchema,
  },
  bootstrap: {
    channel: CodingAgentIpc.Bootstrap,
    args: z.tuple([WorkspaceRootSchema]),
    result: ActionResultSchema,
  },
  prepareLane: {
    channel: CodingAgentIpc.PrepareLane,
    args: z.tuple([LaneRefSchema]),
    result: ActionResultSchema,
  },
  createMission: {
    channel: CodingAgentIpc.CreateMission,
    args: z.tuple([
      z.object({
        workspaceRoot: WorkspaceRootSchema,
        profileId: z.string(),
        title: z.string().optional(),
      }),
    ]),
    result: ActionResultSchema,
  },
  selectLane: {
    channel: CodingAgentIpc.SelectLane,
    args: z.tuple([LaneRefSchema]),
    result: ActionResultSchema,
  },
  prompt: {
    channel: CodingAgentIpc.Prompt,
    args: z.tuple([
      z.object({ workspaceRoot: WorkspaceRootSchema, prompt: CodingPromptInputSchema }),
    ]),
    result: ActionResultSchema,
  },
  listPendingMessages: {
    channel: CodingAgentIpc.ListPendingMessages,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      items: z.array(PendingMessageSchema).optional(),
      error: z.string().optional(),
    }),
  },
  enqueuePendingMessage: {
    channel: CodingAgentIpc.EnqueuePendingMessage,
    args: z.tuple([z.object({ laneId: z.string(), text: z.string() })]),
    result: z.object({
      success: z.boolean(),
      item: PendingMessageSchema.optional(),
      error: z.string().optional(),
    }),
  },
  updatePendingMessage: {
    channel: CodingAgentIpc.UpdatePendingMessage,
    args: z.tuple([z.object({ laneId: z.string(), itemId: z.string(), text: z.string() })]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  deletePendingMessage: {
    channel: CodingAgentIpc.DeletePendingMessage,
    args: z.tuple([z.object({ laneId: z.string(), itemId: z.string() })]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  steerPendingMessage: {
    channel: CodingAgentIpc.SteerPendingMessage,
    args: z.tuple([
      z.object({ workspaceRoot: WorkspaceRootSchema, laneId: z.string(), itemId: z.string() }),
    ]),
    result: ActionResultSchema,
  },
  followUpPendingMessage: {
    channel: CodingAgentIpc.FollowUpPendingMessage,
    args: z.tuple([
      z.object({ workspaceRoot: WorkspaceRootSchema, laneId: z.string(), itemId: z.string() }),
    ]),
    result: ActionResultSchema,
  },
  confirmSessionRecovery: {
    channel: CodingAgentIpc.ConfirmSessionRecovery,
    args: z.tuple([
      z.object({
        workspaceRoot: WorkspaceRootSchema,
        laneId: z.string(),
        includeRecoveryContext: z.boolean(),
      }),
    ]),
    result: ActionResultSchema,
  },
  cancel: {
    channel: CodingAgentIpc.Cancel,
    args: z.tuple([LaneRefSchema]),
    result: ActionResultSchema,
  },
  previewHandoff: {
    channel: CodingAgentIpc.PreviewHandoff,
    args: z.tuple([
      z.object({
        workspaceRoot: WorkspaceRootSchema,
        sourceLaneId: z.string(),
        targetLaneId: z.string(),
      }),
    ]),
    result: z.object({
      success: z.boolean(),
      content: z.record(z.string(), z.unknown()).optional(),
      error: z.string().optional(),
    }),
  },
  handoff: {
    channel: CodingAgentIpc.Handoff,
    args: z.tuple([
      z.object({
        workspaceRoot: WorkspaceRootSchema,
        sourceLaneId: z.string(),
        targetLaneId: z.string(),
      }),
    ]),
    result: ActionResultSchema,
  },
  addLane: {
    channel: CodingAgentIpc.AddLane,
    args: z.tuple([
      z.object({
        workspaceRoot: WorkspaceRootSchema,
        missionId: z.string(),
        profileId: z.string(),
      }),
    ]),
    result: ActionResultSchema,
  },
  createCollaborationPreset: {
    channel: CodingAgentIpc.CreateCollaborationPreset,
    args: z.tuple([
      z.object({
        workspaceRoot: WorkspaceRootSchema,
        missionId: z.string(),
        reviewerProfileId: z.string(),
        verifierProfileId: z.string(),
      }),
    ]),
    result: ActionResultSchema,
  },
  saveLaneView: {
    channel: CodingAgentIpc.SaveLaneView,
    args: z.tuple([
      z.object({
        workspaceRoot: WorkspaceRootSchema,
        view: z.object({
          laneId: z.string(),
          draft: z.string(),
          scrollPosition: z.number(),
        }),
      }),
    ]),
    result: ActionResultSchema,
  },
  setLaneConfigOption: {
    channel: CodingAgentIpc.SetLaneConfigOption,
    args: z.tuple([
      z.object({
        workspaceRoot: WorkspaceRootSchema,
        option: z.object({
          laneId: z.string(),
          configId: z.string(),
          value: z.union([z.string(), z.boolean()]),
        }),
      }),
    ]),
    result: ActionResultSchema,
  },
  setLaneModelOverride: {
    channel: CodingAgentIpc.SetLaneModelOverride,
    args: z.tuple([
      z.object({
        workspaceRoot: WorkspaceRootSchema,
        laneId: z.string(),
        modelOverride: z.string().nullable(),
      }),
    ]),
    result: ActionResultSchema,
  },
  previewLaneChanges: {
    channel: CodingAgentIpc.PreviewLaneChanges,
    args: z.tuple([LaneRefSchema]),
    result: z.object({
      success: z.boolean(),
      preview: z.object({ laneId: z.string(), diff: z.string() }).optional(),
      error: z.string().optional(),
    }),
  },
  applyLaneChanges: {
    channel: CodingAgentIpc.ApplyLaneChanges,
    args: z.tuple([LaneRefSchema]),
    result: ActionResultSchema,
  },
  getGitStatus: {
    channel: CodingAgentIpc.GetGitStatus,
    args: z.tuple([GitTargetSchema]),
    result: GitStatusResultSchema,
  },
  getGitDiff: {
    channel: CodingAgentIpc.GetGitDiff,
    args: z.tuple([GitTargetSchema.extend({ path: z.string(), scope: z.string() })]),
    result: z.object({
      success: z.boolean(),
      diff: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  stageGitPaths: {
    channel: CodingAgentIpc.StageGitPaths,
    args: z.tuple([GitTargetSchema.extend({ paths: z.array(z.string()) })]),
    result: GitStatusResultSchema,
  },
  unstageGitPaths: {
    channel: CodingAgentIpc.UnstageGitPaths,
    args: z.tuple([GitTargetSchema.extend({ paths: z.array(z.string()) })]),
    result: GitStatusResultSchema,
  },
  commitGitChanges: {
    channel: CodingAgentIpc.CommitGitChanges,
    args: z.tuple([GitTargetSchema.extend({ message: z.string(), paths: z.array(z.string()) })]),
    result: GitStatusResultSchema,
  },
  commitAndPushGitChanges: {
    channel: CodingAgentIpc.CommitAndPushGitChanges,
    args: z.tuple([GitTargetSchema.extend({ message: z.string(), paths: z.array(z.string()) })]),
    result: z.object({
      success: z.boolean(),
      result: z
        .object({
          status: GitStatusSchema,
          pushed: z.boolean(),
          pushError: z.string().optional(),
        })
        .optional(),
      error: z.string().optional(),
    }),
  },
  pushGitBranch: {
    channel: CodingAgentIpc.PushGitBranch,
    args: z.tuple([GitTargetSchema]),
    result: GitStatusResultSchema,
  },
  switchGitBranch: {
    channel: CodingAgentIpc.SwitchGitBranch,
    args: z.tuple([GitTargetSchema.extend({ branch: z.string() })]),
    result: GitStatusResultSchema,
  },
  createGitBranch: {
    channel: CodingAgentIpc.CreateGitBranch,
    args: z.tuple([GitTargetSchema.extend({ branch: z.string() })]),
    result: GitStatusResultSchema,
  },
  createGitPullRequest: {
    channel: CodingAgentIpc.CreateGitPullRequest,
    args: z.tuple([
      GitTargetSchema.extend({
        title: z.string(),
        body: z.string(),
        base: z.string(),
        draft: z.boolean().optional(),
      }),
    ]),
    result: z.object({
      success: z.boolean(),
      url: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  listWorkspaceFiles: {
    channel: CodingAgentIpc.ListWorkspaceFiles,
    args: z.tuple([GitTargetSchema.extend({ path: z.string().optional() })]),
    result: z.object({
      success: z.boolean(),
      entries: z.array(WorkspaceFileEntrySchema).optional(),
      error: z.string().optional(),
    }),
  },
  readWorkspaceFile: {
    channel: CodingAgentIpc.ReadWorkspaceFile,
    args: z.tuple([GitTargetSchema.extend({ path: z.string().optional() })]),
    result: z.object({
      success: z.boolean(),
      file: WorkspaceFileContentSchema.optional(),
      error: z.string().optional(),
    }),
  },
  writeWorkspaceFile: {
    channel: CodingAgentIpc.WriteWorkspaceFile,
    args: z.tuple([
      GitTargetSchema.extend({
        path: z.string().optional(),
        content: z.string(),
        expectedSha256: z.string(),
      }),
    ]),
    result: z.object({
      success: z.boolean(),
      file: WorkspaceFileContentSchema.optional(),
      error: z.string().optional(),
    }),
  },
  discoverAgents: {
    channel: CodingAgentIpc.DiscoverAgents,
    args: z.tuple([z.object({ workspaceRoot: WorkspaceRootSchema })]),
    result: ActionResultSchema,
  },
  probeAgent: {
    channel: CodingAgentIpc.ProbeAgent,
    args: z.tuple([z.object({ workspaceRoot: WorkspaceRootSchema, profileId: z.string() })]),
    result: ActionResultSchema,
  },
  addProfile: {
    channel: CodingAgentIpc.AddProfile,
    args: z.tuple([
      z.object({
        workspaceRoot: WorkspaceRootSchema,
        profile: z.object({
          name: z.string(),
          description: z.string(),
          command: z.string(),
          args: z.array(z.string()),
        }),
      }),
    ]),
    result: ActionResultSchema,
  },
  trustProfile: {
    channel: CodingAgentIpc.TrustProfile,
    args: z.tuple([z.object({ workspaceRoot: WorkspaceRootSchema, profileId: z.string() })]),
    result: ActionResultSchema,
  },
  authenticateProfile: {
    channel: CodingAgentIpc.AuthenticateProfile,
    args: z.tuple([
      z.object({ workspaceRoot: WorkspaceRootSchema, profileId: z.string(), methodId: z.string() }),
    ]),
    result: ActionResultSchema,
  },
  startAuthTerminal: {
    channel: CodingAgentIpc.StartAuthTerminal,
    args: z.tuple([
      z.object({ workspaceRoot: WorkspaceRootSchema, profileId: z.string(), methodId: z.string() }),
    ]),
    result: z.object({
      success: z.boolean(),
      terminal: z
        .object({ id: z.string(), profileId: z.string(), methodId: z.string() })
        .optional(),
      error: z.string().optional(),
    }),
  },
  writeAuthTerminal: {
    channel: CodingAgentIpc.WriteAuthTerminal,
    args: z.tuple([z.object({ id: z.string(), data: z.string() })]),
    result: ActionResultSchema,
  },
  resizeAuthTerminal: {
    channel: CodingAgentIpc.ResizeAuthTerminal,
    args: z.tuple([z.object({ id: z.string(), columns: z.number(), rows: z.number() })]),
    result: ActionResultSchema,
  },
  cancelAuthTerminal: {
    channel: CodingAgentIpc.CancelAuthTerminal,
    args: z.tuple([z.string()]),
    result: ActionResultSchema,
  },
  respondPermission: {
    channel: CodingAgentIpc.RespondPermission,
    args: z.tuple([
      z.object({
        workspaceRoot: WorkspaceRootSchema,
        response: z.object({
          requestId: z.string(),
          outcome: z.enum([CodingPermissionOutcome.Selected, CodingPermissionOutcome.Cancelled]),
          optionId: z.string().optional(),
        }),
      }),
    ]),
    result: ActionResultSchema,
  },
  respondElicitation: {
    channel: CodingAgentIpc.RespondElicitation,
    args: z.tuple([
      z.object({
        workspaceRoot: WorkspaceRootSchema,
        response: z.object({ requestId: z.string(), answer: z.string() }),
      }),
    ]),
    result: ActionResultSchema,
  },
  cancelElicitation: {
    channel: CodingAgentIpc.CancelElicitation,
    args: z.tuple([z.object({ workspaceRoot: WorkspaceRootSchema, requestId: z.string() })]),
    result: ActionResultSchema,
  },
  loadEventPage: {
    channel: CodingAgentIpc.LoadEventPage,
    args: z.tuple([
      z.object({
        workspaceRoot: WorkspaceRootSchema,
        laneId: z.string(),
        beforeSequence: z.number().nullable(),
      }),
    ]),
    result: z.object({
      success: z.boolean(),
      page: z.unknown().optional(),
      error: z.string().optional(),
    }),
  },
});
