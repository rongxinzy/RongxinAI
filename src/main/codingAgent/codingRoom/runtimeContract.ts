/**
 * Contract the host runtime must satisfy for the coding room service. Kept in
 * its own module so every coding-room layer can reference it without cycles.
 */
import type { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import type { BuiltinCodingCommandChoices } from '../drivers/builtinCodingCommands';
import type { BuiltinCodingMcpSnapshot } from '../builtinCodingMcpReport';

export interface CodingRoomRuntime {
  startBuiltinSession(input: {
    sessionId: string;
    workspaceRoot: string;
    prompt: string;
    modelOverride?: string | null;
    thinkingLevel?: string;
    permissionMode?: WorkbenchApprovalMode;
    /** Whether the turn must run inside the long-horizon goal loop. */
    goalMode?: boolean;
    /** Whether the turn must run as a read-only planning turn. */
    planMode?: boolean;
    /** Skills the lane runs with; an empty list clears the selection. */
    skillIds?: string[];
    /** Experts the lane runs with; an empty list clears the selection. */
    expertIds?: string[];
  }): Promise<void>;
  /** Installed skills and experts advertised with the built-in command list. */
  listCommandChoices?(): BuiltinCodingCommandChoices;
  /** Bumped when the advertised skills, experts or MCP servers change. */
  commandCatalogGeneration?(): number;
  /** Applies approval-mode changes to a live built-in session. */
  setBuiltinApprovalMode?(sessionId: string, mode: WorkbenchApprovalMode): void;
  cancelBuiltinSession(sessionId: string): Promise<void>;
  /** Delivers the user's answer to a question the live built-in session asked. */
  respondBuiltinElicitation?(requestId: string, answer: string): boolean;
  /** Cancels a question the live built-in session asked. */
  cancelBuiltinElicitation?(requestId: string, reason: string): boolean;
  enqueueBuiltinMessage?(sessionId: string, prompt: string): { success: boolean; error?: string };
  steerBuiltinMessage?(
    sessionId: string,
    prompt: string,
  ): Promise<{ success: boolean; error?: string }>;
  /** Applies model/thinking-level changes to a live built-in session. */
  patchBuiltinSession?(
    sessionId: string,
    patch: { model?: string | null; thinkingLevel?: string | null },
  ): Promise<void>;
  /** Compacts a live built-in session's context without sending a model turn. */
  compactBuiltinSession?(sessionId: string): Promise<{ cancelled: boolean }>;
  /** MCP servers and tools the built-in agent can reach right now. */
  describeBuiltinMcp?(target?: string): BuiltinCodingMcpSnapshot | null;
  /** Runs an application-owned action once queued built-in prompts settle. */
  enqueueBuiltinControlAction?(
    sessionId: string,
    action: () => Promise<void>,
  ): { success: boolean; error?: string };
  /** Whether the built-in Pi session currently has a turn in flight. */
  isBuiltinSessionRunning?(sessionId: string): boolean;
  /** Whether a live built-in Pi session exists for this lane in this process. */
  isBuiltinSessionActive?(sessionId: string): boolean;
  getBuiltinWorkbenchLink(sessionId: string): { taskId: string; runId: string } | null;
  beginExternalWorkbenchRun(input: { sessionId: string; goal: string; workspaceRoot: string }): {
    taskId: string;
    runId: string;
  };
  completeExternalWorkbenchRun(input: {
    sessionId: string;
    runId: string;
    workspaceRoot: string;
    finalAnswer: string;
  }): void | Promise<void>;
  failExternalWorkbenchRun?(input: { sessionId: string; runId: string; error: string }): void;
  cancelExternalWorkbenchRun?(input: { sessionId: string; runId: string }): void;
  respondBuiltinPermission?(requestId: string, approved: boolean): void;
  validateBuiltinModel?(): Promise<void>;
  createIsolatedWorkspace?(input: {
    workspaceRoot: string;
    laneId: string;
    baseline: string;
  }): Promise<string>;
  getWorkspaceBaseline?(workspaceRoot: string): Promise<string | null>;
  getWorkspaceDiff?(workspaceRoot: string): Promise<string | null>;
  getIsolatedWorkspaceDiff?(workspaceRoot: string): Promise<string>;
  applyIsolatedWorkspaceDiff?(input: {
    workspaceRoot: string;
    isolatedWorkspaceRoot: string;
  }): Promise<void>;
  applyWorkspacePatch?(input: { workspaceRoot: string; patch: string }): Promise<void>;
}

export type DriverSession = { id: string; connectionGeneration: number | null };
