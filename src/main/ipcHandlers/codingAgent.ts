import { BrowserWindow, ipcMain } from 'electron';

import {
  CodingAgentIpc,
  type AddCodingAgentProfileInput,
  type CodingLaneViewStateInput,
  type CodingLaneConfigOptionInput,
  type CodingPermissionResponse,
  type CreateCodingCollaborationPresetInput,
  type CodingPromptInput,
  type CreateCodingMissionInput,
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
  ipcMain.handle(CodingAgentIpc.Bootstrap, (_event, workspaceRoot: string) => ({
    success: true,
    snapshot: service.bootstrap(workspaceRoot),
  }));
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
  ipcMain.handle(
    CodingAgentIpc.ConfirmSessionRecovery,
    async (_event, input: { workspaceRoot: string; laneId: string; includeRecoveryContext: boolean }) => {
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
