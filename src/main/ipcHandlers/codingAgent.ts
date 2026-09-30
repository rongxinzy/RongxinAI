import { BrowserWindow, ipcMain } from 'electron';

import {
  CodingAgentIpc,
  CodingEventWindowPageSize,
  type AddCodingAgentProfileInput,
  type CodingGitCommitInput,
  type CodingGitCommitAndPushInput,
  type CodingGitBranchInput,
  type CodingGitPullRequestInput,
  type CodingGitDiffInput,
  type CodingGitPathActionInput,
  type CodingGitTargetInput,
  type CodingWorkspaceFileInput,
  type CodingWorkspaceFileWriteInput,
  type CodingLaneViewStateInput,
  type CodingLaneConfigOptionInput,
  type CodingPermissionResponse,
  type CodingElicitationResponse,
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
import { agentResourceDiagnostics } from '../agentResourceDiagnostics';

type CodingHandler<T> = () => T | Promise<T>;

/**
 * Single entry point for every coding IPC handler: a failure is logged with its
 * channel and normalised into the `{ success: false, error }` shape the
 * renderer already understands. `describeFailure` adds channel-specific fields
 * on top of that shape (e.g. the Git worktree conflict flag).
 */
async function runCodingHandler<T>(
  channel: string,
  run: CodingHandler<T>,
  describeFailure?: (error: unknown) => Record<string, unknown>,
): Promise<T | { success: false; error: string }> {
  try {
    return await run();
  } catch (error) {
    console.error(`[CodingAgentIpc] ${channel} failed:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      ...describeFailure?.(error),
    };
  }
}

export function registerCodingAgentIpcHandlers(getService: () => CodingRoomService): void {
  const service = getService();
  service.on('changed', snapshot => {
    agentResourceDiagnostics.recordRoomSnapshot(snapshot.events.length, snapshot.lanes.length);
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
    return runCodingHandler(CodingAgentIpc.ListProfiles, () => {
      return { success: true, profiles: service.listProfiles() };
    });
  });
  ipcMain.handle(CodingAgentIpc.ListWorkspaces, () => {
    return runCodingHandler(CodingAgentIpc.ListWorkspaces, () => {
      return { success: true, workspaces: service.listWorkspaces() };
    });
  });
  ipcMain.handle(CodingAgentIpc.CreateWorkspace, (_event, input: CreateCodingWorkspaceInput) => {
    return runCodingHandler(CodingAgentIpc.CreateWorkspace, () => {
      return { success: true, workspaces: service.createWorkspace(input) };
    });
  });
  ipcMain.handle(CodingAgentIpc.UpdateWorkspace, (_event, input: UpdateCodingWorkspaceInput) => {
    return runCodingHandler(CodingAgentIpc.UpdateWorkspace, () => {
      return { success: true, workspaces: service.updateWorkspace(input) };
    });
  });
  ipcMain.handle(CodingAgentIpc.DeleteWorkspace, (_event, workspaceId: string) => {
    return runCodingHandler(CodingAgentIpc.DeleteWorkspace, () => {
      return { success: true, workspaces: service.deleteWorkspace(workspaceId) };
    });
  });
  ipcMain.handle(
    CodingAgentIpc.DeleteSession,
    (_event, input: { workspaceRoot: string; laneId: string }) => {
      return runCodingHandler(CodingAgentIpc.DeleteSession, () => {
        return {
          success: true,
          workspaces: service.deleteSession(input.workspaceRoot, input.laneId),
        };
      });
    },
  );
  ipcMain.handle(CodingAgentIpc.GetProfileConfigOptions, (_event, profileId: string) => {
    return runCodingHandler(CodingAgentIpc.GetProfileConfigOptions, () => {
      return { success: true, configOptions: service.getProfileConfigOptions(profileId) };
    });
  });
  ipcMain.handle(CodingAgentIpc.GetProfileAvailableCommands, (_event, profileId: string) => {
    return runCodingHandler(CodingAgentIpc.GetProfileAvailableCommands, () => {
      return { success: true, commands: service.getProfileAvailableCommands(profileId) };
    });
  });
  ipcMain.handle(CodingAgentIpc.CreateSession, async (_event, input: CreateCodingSessionInput) => {
    return runCodingHandler(CodingAgentIpc.CreateSession, async () => {
      return { success: true, snapshot: await service.createSession(input) };
    });
  });
  ipcMain.handle(CodingAgentIpc.StartSession, async (_event, input: StartCodingSessionInput) => {
    return runCodingHandler(CodingAgentIpc.StartSession, async () => {
      return { success: true, snapshot: await service.startSession(input) };
    });
  });
  ipcMain.handle(CodingAgentIpc.Bootstrap, (_event, workspaceRoot: string) => {
    return runCodingHandler(CodingAgentIpc.Bootstrap, () => {
      return {
        success: true,
        snapshot: service.bootstrap(workspaceRoot, {
          eventLimitPerLane: CodingEventWindowPageSize,
        }),
      };
    });
  });
  service.on('eventDelta', (delta: import('../../shared/codingAgent').CodingRoomEventDelta) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CodingAgentIpc.EventDelta, delta);
    }
  });
  ipcMain.handle(
    CodingAgentIpc.LoadEventPage,
    (_event, input: { workspaceRoot: string; laneId: string; beforeSequence: number | null }) => {
      return runCodingHandler(CodingAgentIpc.LoadEventPage, () => {
        return {
          success: true,
          page: service.loadEventPage(input.workspaceRoot, input.laneId, input.beforeSequence),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.PrepareLane,
    async (_event, input: { workspaceRoot: string; laneId: string }) => {
      return runCodingHandler(CodingAgentIpc.PrepareLane, async () => {
        return {
          success: true,
          snapshot: await service.prepareLane(input.workspaceRoot, input.laneId),
        };
      });
    },
  );
  ipcMain.handle(CodingAgentIpc.CreateMission, async (_event, input: CreateCodingMissionInput) => {
    return runCodingHandler(CodingAgentIpc.CreateMission, async () => {
      return { success: true, snapshot: await service.createMission(input) };
    });
  });
  ipcMain.handle(
    CodingAgentIpc.SelectLane,
    (_event, input: { workspaceRoot: string; laneId: string }) => {
      return runCodingHandler(CodingAgentIpc.SelectLane, () => {
        return { success: true, snapshot: service.selectLane(input.workspaceRoot, input.laneId) };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.Prompt,
    async (_event, input: { workspaceRoot: string; prompt: CodingPromptInput }) => {
      return runCodingHandler(CodingAgentIpc.Prompt, async () => {
        return { success: true, snapshot: await service.prompt(input.workspaceRoot, input.prompt) };
      });
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
      return runCodingHandler(CodingAgentIpc.SteerPendingMessage, async () => {
        return {
          success: true,
          snapshot: await service.steerPendingMessage(input.workspaceRoot, input.laneId, input.itemId),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.FollowUpPendingMessage,
    async (_event, input: { workspaceRoot: string; laneId: string; itemId: string }) => {
      return runCodingHandler(CodingAgentIpc.FollowUpPendingMessage, async () => {
        return {
          success: true,
          snapshot: await service.followUpPendingMessage(
            input.workspaceRoot,
            input.laneId,
            input.itemId,
          ),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.ConfirmSessionRecovery,
    async (
      _event,
      input: { workspaceRoot: string; laneId: string; includeRecoveryContext: boolean },
    ) => {
      return runCodingHandler(CodingAgentIpc.ConfirmSessionRecovery, async () => {
        return {
          success: true,
          snapshot: await service.confirmSessionRecovery(
            input.workspaceRoot,
            input.laneId,
            input.includeRecoveryContext,
          ),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.Cancel,
    async (_event, input: { workspaceRoot: string; laneId: string }) => {
      return runCodingHandler(CodingAgentIpc.Cancel, async () => {
        return { success: true, snapshot: await service.cancel(input.workspaceRoot, input.laneId) };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.PreviewHandoff,
    async (
      _event,
      input: { workspaceRoot: string; sourceLaneId: string; targetLaneId: string },
    ) => {
      return runCodingHandler(CodingAgentIpc.PreviewHandoff, async () => {
        return {
          success: true,
          content: await service.previewHandoff(
            input.workspaceRoot,
            input.sourceLaneId,
            input.targetLaneId,
          ),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.Handoff,
    async (
      _event,
      input: { workspaceRoot: string; sourceLaneId: string; targetLaneId: string },
    ) => {
      return runCodingHandler(CodingAgentIpc.Handoff, async () => {
        return {
          success: true,
          snapshot: await service.handoff(
            input.workspaceRoot,
            input.sourceLaneId,
            input.targetLaneId,
          ),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.CreateCollaborationPreset,
    async (_event, input: CreateCodingCollaborationPresetInput) => {
      return runCodingHandler(CodingAgentIpc.CreateCollaborationPreset, async () => {
        return {
          success: true,
          snapshot: await service.createImplementationReviewVerificationPreset(input),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.AddLane,
    async (_event, input: { workspaceRoot: string; missionId: string; profileId: string }) => {
      return runCodingHandler(CodingAgentIpc.AddLane, async () => {
        return {
          success: true,
          snapshot: await service.addLane(input.workspaceRoot, input.missionId, input.profileId),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.SaveLaneView,
    (_event, input: { workspaceRoot: string; view: CodingLaneViewStateInput }) => {
      return runCodingHandler(CodingAgentIpc.SaveLaneView, () => {
        return { success: true, snapshot: service.saveLaneView(input.workspaceRoot, input.view) };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.PreviewLaneChanges,
    async (_event, input: { workspaceRoot: string; laneId: string }) => {
      return runCodingHandler(CodingAgentIpc.PreviewLaneChanges, async () => {
        return {
          success: true,
          preview: await service.previewLaneChanges(input.workspaceRoot, input.laneId),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.ApplyLaneChanges,
    async (_event, input: { workspaceRoot: string; laneId: string }) => {
      return runCodingHandler(CodingAgentIpc.ApplyLaneChanges, async () => {
        return {
          success: true,
          snapshot: await service.applyLaneChanges(input.workspaceRoot, input.laneId),
        };
      }, error => ({ conflict: error instanceof GitWorktreeConflictError }));
    },
  );
  ipcMain.handle(CodingAgentIpc.GetGitStatus, async (_event, input: CodingGitTargetInput) => {
    return runCodingHandler(CodingAgentIpc.GetGitStatus, async () => {
      return { success: true, status: await service.getGitStatus(input) };
    });
  });
  ipcMain.handle(CodingAgentIpc.GetGitDiff, async (_event, input: CodingGitDiffInput) => {
    return runCodingHandler(CodingAgentIpc.GetGitDiff, async () => {
      return { success: true, diff: await service.getGitDiff(input) };
    });
  });
  ipcMain.handle(CodingAgentIpc.StageGitPaths, async (_event, input: CodingGitPathActionInput) => {
    return runCodingHandler(CodingAgentIpc.StageGitPaths, async () => {
      return { success: true, status: await service.stageGitPaths(input) };
    });
  });
  ipcMain.handle(
    CodingAgentIpc.UnstageGitPaths,
    async (_event, input: CodingGitPathActionInput) => {
      return runCodingHandler(CodingAgentIpc.UnstageGitPaths, async () => {
        return { success: true, status: await service.unstageGitPaths(input) };
      });
    },
  );
  ipcMain.handle(CodingAgentIpc.CommitGitChanges, async (_event, input: CodingGitCommitInput) => {
    return runCodingHandler(CodingAgentIpc.CommitGitChanges, async () => {
      console.debug(
        `[CodingGit] received a commit request with ${input.paths.length} selected path(s)`,
      );
      return { success: true, status: await service.commitGitChanges(input) };
    });
  });
  ipcMain.handle(
    CodingAgentIpc.CommitAndPushGitChanges,
    async (_event, input: CodingGitCommitAndPushInput) => {
      return runCodingHandler(CodingAgentIpc.CommitAndPushGitChanges, async () => {
        console.debug(
          `[CodingGit] received a commit and push request with ${input.paths.length} selected path(s)`,
        );
        return { success: true, result: await service.commitAndPushGitChanges(input) };
      });
    },
  );
  ipcMain.handle(CodingAgentIpc.PushGitBranch, async (_event, input: CodingGitTargetInput) => {
    return runCodingHandler(CodingAgentIpc.PushGitBranch, async () => {
      return { success: true, status: await service.pushGitBranch(input) };
    });
  });
  ipcMain.handle(CodingAgentIpc.SwitchGitBranch, async (_event, input: CodingGitBranchInput) => {
    return runCodingHandler(CodingAgentIpc.SwitchGitBranch, async () => {
      return { success: true, status: await service.switchGitBranch(input) };
    });
  });
  ipcMain.handle(CodingAgentIpc.CreateGitBranch, async (_event, input: CodingGitBranchInput) => {
    return runCodingHandler(CodingAgentIpc.CreateGitBranch, async () => {
      return { success: true, status: await service.createGitBranch(input) };
    });
  });
  ipcMain.handle(CodingAgentIpc.CreateGitPullRequest, async (_event, input: CodingGitPullRequestInput) => {
    return runCodingHandler(CodingAgentIpc.CreateGitPullRequest, async () => {
      return { success: true, url: await service.createGitPullRequest(input) };
    });
  });
  ipcMain.handle(CodingAgentIpc.ListWorkspaceFiles, async (_event, input: CodingWorkspaceFileInput) => {
    return runCodingHandler(CodingAgentIpc.ListWorkspaceFiles, async () => {
      return { success: true, entries: await service.listWorkspaceFiles(input) };
    });
  });
  ipcMain.handle(CodingAgentIpc.ReadWorkspaceFile, async (_event, input: CodingWorkspaceFileInput) => {
    return runCodingHandler(CodingAgentIpc.ReadWorkspaceFile, async () => {
      return { success: true, file: await service.readWorkspaceFile(input) };
    });
  });
  ipcMain.handle(
    CodingAgentIpc.WriteWorkspaceFile,
    async (_event, input: CodingWorkspaceFileWriteInput) => {
      return runCodingHandler(CodingAgentIpc.WriteWorkspaceFile, async () => {
        return { success: true, file: await service.writeWorkspaceFile(input) };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.SetLaneConfigOption,
    async (_event, input: { workspaceRoot: string; option: CodingLaneConfigOptionInput }) => {
      return runCodingHandler(CodingAgentIpc.SetLaneConfigOption, async () => {
        return {
          success: true,
          snapshot: await service.setLaneConfigOption(input.workspaceRoot, input.option),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.SetLaneModelOverride,
    async (
      _event,
      input: { workspaceRoot: string; laneId: string; modelOverride: string | null },
    ) => {
      return runCodingHandler(CodingAgentIpc.SetLaneModelOverride, async () => {
        return {
          success: true,
          snapshot: await service.setLaneModelOverride(
            input.workspaceRoot,
            input.laneId,
            input.modelOverride,
          ),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.DiscoverAgents,
    async (_event, input: { workspaceRoot: string }) => {
      return runCodingHandler(CodingAgentIpc.DiscoverAgents, async () => {
        return {
          success: true,
          snapshot: await service.discoverAgents(input.workspaceRoot),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.ProbeAgent,
    async (_event, input: { workspaceRoot: string; profileId: string }) => {
      return runCodingHandler(CodingAgentIpc.ProbeAgent, async () => {
        return {
          success: true,
          snapshot: await service.probeAgent(input.workspaceRoot, input.profileId),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.AddProfile,
    (_event, input: { workspaceRoot: string; profile: AddCodingAgentProfileInput }) => {
      return runCodingHandler(CodingAgentIpc.AddProfile, () => {
        return { success: true, snapshot: service.addProfile(input.workspaceRoot, input.profile) };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.TrustProfile,
    (_event, input: { workspaceRoot: string; profileId: string }) => {
      return runCodingHandler(CodingAgentIpc.TrustProfile, () => {
        return {
          success: true,
          snapshot: service.trustProfile(input.workspaceRoot, input.profileId),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.AuthenticateProfile,
    async (_event, input: { workspaceRoot: string; profileId: string; methodId: string }) => {
      return runCodingHandler(CodingAgentIpc.AuthenticateProfile, async () => {
        return {
          success: true,
          snapshot: await service.authenticateProfile(
            input.workspaceRoot,
            input.profileId,
            input.methodId,
          ),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.StartAuthTerminal,
    (_event, input: { workspaceRoot: string; profileId: string; methodId: string }) => {
      return runCodingHandler(CodingAgentIpc.StartAuthTerminal, () => {
        return {
          success: true,
          terminal: service.startTerminalAuthentication(
            input.workspaceRoot,
            input.profileId,
            input.methodId,
          ),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.WriteAuthTerminal,
    (_event, input: { id: string; data: string }) => {
      return runCodingHandler(CodingAgentIpc.WriteAuthTerminal, () => {
        service.writeAuthTerminal(input.id, input.data);
        return { success: true };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.ResizeAuthTerminal,
    (_event, input: { id: string; columns: number; rows: number }) => {
      return runCodingHandler(CodingAgentIpc.ResizeAuthTerminal, () => {
        service.resizeAuthTerminal(input.id, input.columns, input.rows);
        return { success: true };
      });
    },
  );
  ipcMain.handle(CodingAgentIpc.CancelAuthTerminal, (_event, id: string) => {
    return runCodingHandler(CodingAgentIpc.CancelAuthTerminal, () => {
      service.cancelAuthTerminal(id);
      return { success: true };
    });
  });
  ipcMain.handle(
    CodingAgentIpc.RespondPermission,
    async (_event, input: { workspaceRoot: string; response: CodingPermissionResponse }) => {
      return runCodingHandler(CodingAgentIpc.RespondPermission, async () => {
        return {
          success: true,
          snapshot: await service.respondToPermission(input.workspaceRoot, input.response),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.RespondElicitation,
    async (_event, input: { workspaceRoot: string; response: CodingElicitationResponse }) => {
      return runCodingHandler(CodingAgentIpc.RespondElicitation, async () => {
        return {
          success: true,
          snapshot: await service.respondElicitation(input.workspaceRoot, input.response),
        };
      });
    },
  );
  ipcMain.handle(
    CodingAgentIpc.CancelElicitation,
    async (_event, input: { workspaceRoot: string; requestId: string }) => {
      return runCodingHandler(CodingAgentIpc.CancelElicitation, async () => {
        return {
          success: true,
          snapshot: await service.cancelElicitation(input.workspaceRoot, input.requestId),
        };
      });
    },
  );
}
