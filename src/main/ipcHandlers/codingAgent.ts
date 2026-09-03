import { BrowserWindow, ipcMain } from 'electron';

import {
  CodingAgentIpc,
  type AddCodingAgentProfileInput,
  type CodingGitCommitInput,
  type CodingGitDiffInput,
  type CodingGitPathActionInput,
  type CodingGitTargetInput,
  type CodingLaneViewStateInput,
  type CodingLaneConfigOptionInput,
  type CodingPermissionResponse,
  type CodingPendingMessagesChangedEvent,
  type CreateCodingCollaborationPresetInput,
  type CodingPromptInput,
  type CreateCodingSessionInput,
  type StartCodingSessionInput,
  type CreateCodingWorkspaceInput,
  type CreateCodingMissionInput,
  type UpdateCodingWorkspaceInput,
} from '../../shared/codingAgent';
import type { CodingRoomService } from '../codingAgent/codingRoomService';
import { GitWorktreeConflictError } from '../codingAgent/gitWorktreeService';

export function registerCodingAgentIpcHandlers(getService: () => CodingRoomService): void {
  const service = getService();
  service.on('changed', snapshot => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CodingAgentIpc.Changed, snapshot);
    }
  });
  service.on('pendingMessagesChanged', (event: CodingPendingMessagesChangedEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CodingAgentIpc.PendingMessagesChanged, event);
    }
  });
  service.on('authTerminalData', event => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CodingAgentIpc.AuthTerminalData, event);
    }
  });
  service.on('authTerminalExit', event => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CodingAgentIpc.AuthTerminalExit, event);
    }
  });
  ipcMain.handle(CodingAgentIpc.ListProfiles, () => {
    try {
      return { success: true, profiles: service.listProfiles() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(CodingAgentIpc.ListWorkspaces, () => {
    try {
      return { success: true, workspaces: service.listWorkspaces() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(CodingAgentIpc.CreateWorkspace, (_event, input: CreateCodingWorkspaceInput) => {
    try {
      return { success: true, workspaces: service.createWorkspace(input) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(CodingAgentIpc.UpdateWorkspace, (_event, input: UpdateCodingWorkspaceInput) => {
    try {
      return { success: true, workspaces: service.updateWorkspace(input) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(CodingAgentIpc.DeleteWorkspace, (_event, workspaceId: string) => {
    try {
      return { success: true, workspaces: service.deleteWorkspace(workspaceId) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(
    CodingAgentIpc.DeleteSession,
    (_event, input: { workspaceRoot: string; laneId: string }) => {
      try {
        return {
          success: true,
          workspaces: service.deleteSession(input.workspaceRoot, input.laneId),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(CodingAgentIpc.GetProfileConfigOptions, (_event, profileId: string) => {
    try {
      return { success: true, configOptions: service.getProfileConfigOptions(profileId) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(CodingAgentIpc.CreateSession, async (_event, input: CreateCodingSessionInput) => {
    try {
      return { success: true, snapshot: await service.createSession(input) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(CodingAgentIpc.StartSession, async (_event, input: StartCodingSessionInput) => {
    try {
      return { success: true, snapshot: await service.startSession(input) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(CodingAgentIpc.Bootstrap, (_event, workspaceRoot: string) => ({
    success: true,
    snapshot: service.bootstrap(workspaceRoot),
  }));
  ipcMain.handle(
    CodingAgentIpc.PrepareLane,
    async (_event, input: { workspaceRoot: string; laneId: string }) => {
      try {
        return {
          success: true,
          snapshot: await service.prepareLane(input.workspaceRoot, input.laneId),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(CodingAgentIpc.CreateMission, async (_event, input: CreateCodingMissionInput) => {
    try {
      return { success: true, snapshot: await service.createMission(input) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(
    CodingAgentIpc.SelectLane,
    (_event, input: { workspaceRoot: string; laneId: string }) => {
      try {
        return { success: true, snapshot: service.selectLane(input.workspaceRoot, input.laneId) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.Prompt,
    async (_event, input: { workspaceRoot: string; prompt: CodingPromptInput }) => {
      try {
        return { success: true, snapshot: await service.prompt(input.workspaceRoot, input.prompt) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(CodingAgentIpc.ListPendingMessages, (_event, laneId: string) => ({
    success: true,
    items: service.listPendingMessages(laneId),
  }));
  ipcMain.handle(CodingAgentIpc.EnqueuePendingMessage, (_event, input: { laneId: string; text: string }) =>
    service.enqueuePendingMessage(input.laneId, input.text),
  );
  ipcMain.handle(CodingAgentIpc.UpdatePendingMessage, (_event, input: { laneId: string; itemId: string; text: string }) =>
    service.updatePendingMessage(input.laneId, input.itemId, input.text),
  );
  ipcMain.handle(CodingAgentIpc.DeletePendingMessage, (_event, input: { laneId: string; itemId: string }) =>
    service.deletePendingMessage(input.laneId, input.itemId),
  );
  ipcMain.handle(
    CodingAgentIpc.SteerPendingMessage,
    async (_event, input: { workspaceRoot: string; laneId: string; itemId: string }) => {
      try {
        return {
          success: true,
          snapshot: await service.steerPendingMessage(input.workspaceRoot, input.laneId, input.itemId),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.FollowUpPendingMessage,
    async (_event, input: { workspaceRoot: string; laneId: string; itemId: string }) => {
      try {
        return {
          success: true,
          snapshot: await service.followUpPendingMessage(
            input.workspaceRoot,
            input.laneId,
            input.itemId,
          ),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.ConfirmSessionRecovery,
    async (
      _event,
      input: { workspaceRoot: string; laneId: string; includeRecoveryContext: boolean },
    ) => {
      try {
        return {
          success: true,
          snapshot: await service.confirmSessionRecovery(
            input.workspaceRoot,
            input.laneId,
            input.includeRecoveryContext,
          ),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.Cancel,
    async (_event, input: { workspaceRoot: string; laneId: string }) => {
      try {
        return { success: true, snapshot: await service.cancel(input.workspaceRoot, input.laneId) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.PreviewHandoff,
    async (
      _event,
      input: { workspaceRoot: string; sourceLaneId: string; targetLaneId: string },
    ) => {
      try {
        return {
          success: true,
          content: await service.previewHandoff(
            input.workspaceRoot,
            input.sourceLaneId,
            input.targetLaneId,
          ),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.Handoff,
    async (
      _event,
      input: { workspaceRoot: string; sourceLaneId: string; targetLaneId: string },
    ) => {
      try {
        return {
          success: true,
          snapshot: await service.handoff(
            input.workspaceRoot,
            input.sourceLaneId,
            input.targetLaneId,
          ),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.CreateCollaborationPreset,
    async (_event, input: CreateCodingCollaborationPresetInput) => {
      try {
        return {
          success: true,
          snapshot: await service.createImplementationReviewVerificationPreset(input),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.AddLane,
    async (_event, input: { workspaceRoot: string; missionId: string; profileId: string }) => {
      try {
        return {
          success: true,
          snapshot: await service.addLane(input.workspaceRoot, input.missionId, input.profileId),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.SaveLaneView,
    (_event, input: { workspaceRoot: string; view: CodingLaneViewStateInput }) => {
      try {
        return { success: true, snapshot: service.saveLaneView(input.workspaceRoot, input.view) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.PreviewLaneChanges,
    async (_event, input: { workspaceRoot: string; laneId: string }) => {
      try {
        return {
          success: true,
          preview: await service.previewLaneChanges(input.workspaceRoot, input.laneId),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.ApplyLaneChanges,
    async (_event, input: { workspaceRoot: string; laneId: string }) => {
      try {
        return {
          success: true,
          snapshot: await service.applyLaneChanges(input.workspaceRoot, input.laneId),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          conflict: error instanceof GitWorktreeConflictError,
        };
      }
    },
  );
  ipcMain.handle(CodingAgentIpc.GetGitStatus, async (_event, input: CodingGitTargetInput) => {
    try {
      return { success: true, status: await service.getGitStatus(input) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(CodingAgentIpc.GetGitDiff, async (_event, input: CodingGitDiffInput) => {
    try {
      return { success: true, diff: await service.getGitDiff(input) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(CodingAgentIpc.StageGitPaths, async (_event, input: CodingGitPathActionInput) => {
    try {
      return { success: true, status: await service.stageGitPaths(input) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(
    CodingAgentIpc.UnstageGitPaths,
    async (_event, input: CodingGitPathActionInput) => {
      try {
        return { success: true, status: await service.unstageGitPaths(input) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(CodingAgentIpc.CommitGitChanges, async (_event, input: CodingGitCommitInput) => {
    try {
      return { success: true, status: await service.commitGitChanges(input) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(CodingAgentIpc.PushGitBranch, async (_event, input: CodingGitTargetInput) => {
    try {
      return { success: true, status: await service.pushGitBranch(input) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(
    CodingAgentIpc.SetLaneConfigOption,
    async (_event, input: { workspaceRoot: string; option: CodingLaneConfigOptionInput }) => {
      try {
        return {
          success: true,
          snapshot: await service.setLaneConfigOption(input.workspaceRoot, input.option),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.SetLaneModelOverride,
    async (
      _event,
      input: { workspaceRoot: string; laneId: string; modelOverride: string | null },
    ) => {
      try {
        return {
          success: true,
          snapshot: await service.setLaneModelOverride(
            input.workspaceRoot,
            input.laneId,
            input.modelOverride,
          ),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.DiscoverAgents,
    async (_event, input: { workspaceRoot: string }) => {
      try {
        return {
          success: true,
          snapshot: await service.discoverAgents(input.workspaceRoot),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.ProbeAgent,
    async (_event, input: { workspaceRoot: string; profileId: string }) => {
      try {
        return {
          success: true,
          snapshot: await service.probeAgent(input.workspaceRoot, input.profileId),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.AddProfile,
    (_event, input: { workspaceRoot: string; profile: AddCodingAgentProfileInput }) => {
      try {
        return { success: true, snapshot: service.addProfile(input.workspaceRoot, input.profile) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.TrustProfile,
    (_event, input: { workspaceRoot: string; profileId: string }) => {
      try {
        return {
          success: true,
          snapshot: service.trustProfile(input.workspaceRoot, input.profileId),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.AuthenticateProfile,
    async (_event, input: { workspaceRoot: string; profileId: string; methodId: string }) => {
      try {
        return {
          success: true,
          snapshot: await service.authenticateProfile(
            input.workspaceRoot,
            input.profileId,
            input.methodId,
          ),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.StartAuthTerminal,
    (_event, input: { workspaceRoot: string; profileId: string; methodId: string }) => {
      try {
        return {
          success: true,
          terminal: service.startTerminalAuthentication(
            input.workspaceRoot,
            input.profileId,
            input.methodId,
          ),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.WriteAuthTerminal,
    (_event, input: { id: string; data: string }) => {
      try {
        service.writeAuthTerminal(input.id, input.data);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(
    CodingAgentIpc.ResizeAuthTerminal,
    (_event, input: { id: string; columns: number; rows: number }) => {
      try {
        service.resizeAuthTerminal(input.id, input.columns, input.rows);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  ipcMain.handle(CodingAgentIpc.CancelAuthTerminal, (_event, id: string) => {
    try {
      service.cancelAuthTerminal(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(
    CodingAgentIpc.RespondPermission,
    async (_event, input: { workspaceRoot: string; response: CodingPermissionResponse }) => {
      try {
        return {
          success: true,
          snapshot: await service.respondToPermission(input.workspaceRoot, input.response),
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
}
