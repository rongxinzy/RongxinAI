/**
 * Coding agent preload surface, split from `../electron.d.ts`.
 *
 * Method signatures derive from the zod IPC contract
 * (`src/shared/ipc/codingAgentContract.ts`). The contract keeps large
 * projections (room snapshot, workspace summaries, event pages) opaque or
 * loosely typed because results are not runtime-validated, so the methods
 * below re-narrow those results to the shared domain types; argument types
 * come straight from the contract. Push subscriptions stay hand-typed.
 */
import type {
  CodingAgentProfile,
  CodingEventPage,
  CodingRoomEventDelta,
  CodingRoomSnapshot,
  CodingWorkspaceFileContent,
  CodingWorkspaceFileEntry,
  CodingWorkspaceSummary,
  CreateCodingWorkspaceInput,
  UpdateCodingWorkspaceInput,
} from '../../../shared/codingAgent';
import type { CoworkPendingMessage } from '../../../shared/cowork/pendingMessageQueue';
import type { IpcContractApi } from '../../../shared/ipc/contract';
import type { codingAgentContract } from '../../../shared/ipc/codingAgentContract';

type Api = IpcContractApi<typeof codingAgentContract>;

/** Re-narrow a contract method's result while keeping its argument types. */
type NarrowResult<M extends keyof Api, R> = (...args: Parameters<Api[M]>) => Promise<R>;

interface CodingAgentActionResult {
  success: boolean;
  error?: string;
  conflict?: boolean;
  snapshot?: CodingRoomSnapshot;
  /** Profiles for manager actions that run before a workspace is open. */
  profiles?: CodingAgentProfile[];
}

/** Contract methods whose only imprecision is the opaque room snapshot. */
type SnapshotMethodKeys =
  | 'createSession'
  | 'startSession'
  | 'bootstrap'
  | 'prepareLane'
  | 'createMission'
  | 'selectLane'
  | 'prompt'
  | 'steerPendingMessage'
  | 'followUpPendingMessage'
  | 'confirmSessionRecovery'
  | 'cancel'
  | 'handoff'
  | 'addLane'
  | 'createCollaborationPreset'
  | 'saveLaneView'
  | 'setLaneConfigOption'
  | 'setLaneModelOverride'
  | 'applyLaneChanges'
  | 'discoverAgents'
  | 'probeAgent'
  | 'addProfile'
  | 'trustProfile'
  | 'authenticateProfile'
  | 'respondPermission'
  | 'respondElicitation'
  | 'cancelElicitation';

type SnapshotMethodOverrides = {
  [K in SnapshotMethodKeys]: NarrowResult<K, CodingAgentActionResult>;
};

interface CodingWorkspacesResult {
  success: boolean;
  workspaces?: CodingWorkspaceSummary[];
  error?: string;
}

export interface CodingAgentApi
  extends
    Omit<
      Api,
      | SnapshotMethodKeys
      | 'writeAuthTerminal'
      | 'resizeAuthTerminal'
      | 'cancelAuthTerminal'
      | 'listProfiles'
      | 'listWorkspaces'
      | 'createWorkspace'
      | 'updateWorkspace'
      | 'deleteWorkspace'
      | 'deleteSession'
      | 'listPendingMessages'
      | 'enqueuePendingMessage'
      | 'loadEventPage'
      | 'listWorkspaceFiles'
      | 'readWorkspaceFile'
      | 'writeWorkspaceFile'
      | 'onChanged'
      | 'onEventDelta'
      | 'onPendingMessagesChanged'
      | 'onAuthTerminalData'
      | 'onAuthTerminalExit'
    >,
    SnapshotMethodOverrides {
  writeAuthTerminal: NarrowResult<'writeAuthTerminal', { success: boolean; error?: string }>;
  resizeAuthTerminal: NarrowResult<'resizeAuthTerminal', { success: boolean; error?: string }>;
  cancelAuthTerminal: NarrowResult<'cancelAuthTerminal', { success: boolean; error?: string }>;
  listProfiles: () => Promise<{
    success: boolean;
    profiles?: CodingAgentProfile[];
    error?: string;
  }>;
  listWorkspaces: () => Promise<CodingWorkspacesResult>;
  createWorkspace: (input: CreateCodingWorkspaceInput) => Promise<CodingWorkspacesResult>;
  updateWorkspace: (input: UpdateCodingWorkspaceInput) => Promise<CodingWorkspacesResult>;
  deleteWorkspace: (workspaceId: string) => Promise<CodingWorkspacesResult>;
  deleteSession: (input: {
    workspaceRoot: string;
    laneId: string;
  }) => Promise<CodingWorkspacesResult>;
  listPendingMessages: (laneId: string) => Promise<{
    success: boolean;
    items?: CoworkPendingMessage[];
    error?: string;
  }>;
  enqueuePendingMessage: (input: { laneId: string; text: string }) => Promise<{
    success: boolean;
    item?: CoworkPendingMessage;
    error?: string;
  }>;
  loadEventPage: NarrowResult<
    'loadEventPage',
    { success: boolean; page?: CodingEventPage; error?: string }
  >;
  listWorkspaceFiles: NarrowResult<
    'listWorkspaceFiles',
    { success: boolean; entries?: CodingWorkspaceFileEntry[]; error?: string }
  >;
  readWorkspaceFile: NarrowResult<
    'readWorkspaceFile',
    { success: boolean; file?: CodingWorkspaceFileContent; error?: string }
  >;
  writeWorkspaceFile: NarrowResult<
    'writeWorkspaceFile',
    { success: boolean; file?: CodingWorkspaceFileContent; error?: string }
  >;
  onChanged: (callback: (snapshot: CodingRoomSnapshot) => void) => () => void;
  onEventDelta: (callback: (delta: CodingRoomEventDelta) => void) => () => void;
  onPendingMessagesChanged: (
    callback: (event: { laneId: string; items: CoworkPendingMessage[] }) => void,
  ) => () => void;
  onAuthTerminalData: (callback: (event: { id: string; data: string }) => void) => () => void;
  onAuthTerminalExit: (
    callback: (event: {
      id: string;
      profileId: string;
      methodId: string;
      exitCode: number;
      signal?: number;
    }) => void,
  ) => () => void;
}
