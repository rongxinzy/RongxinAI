import { randomUUID } from 'crypto';
import path from 'path';

import { buildSessionTitleFromInput } from '../../common/sessionTitle';
import {
  CodingAgentDriverKind,
  CodingErrorDetailMessage,
  CodingErrorMessage,
  CodingAgentProfileId,
  CodingAgentProfileStatus,
  CodingWorkflowStage,
  type CodingAgentLane,
  type CodingAgentProfile,
  type CodingRoom,
  type StartCodingSessionInput,
} from '../../shared/codingAgent';
import { t } from '../i18n';
import { isAcpAuthenticationRequired } from './acp/authMethods';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { CodingRoomRepository } from './codingRoomRepository';
import type { CodingAgentDriver, CodingAgentSession } from './drivers/codingAgentDriver';
import { CodingDriverFactory } from './drivers/driverFactory';
import type { CodingDriverPool } from './codingRoom/codingDriverPool';

interface ResolvedSessionTarget {
  room: CodingRoom;
  profile: CodingAgentProfile;
  sourceRoot: string;
}

export interface PreparedCodingSession {
  room: CodingRoom;
  profile: CodingAgentProfile;
  lane: CodingAgentLane;
  driver: CodingAgentDriver;
  driverSession: CodingAgentSession;
}

const resolveSessionTarget = (
  repository: CodingRoomRepository,
  registry: CodingAgentRegistry,
  input: StartCodingSessionInput,
): ResolvedSessionTarget => {
  registry.refreshBuiltinReadiness();
  const room = repository.getRoomById(input.workspaceId);
  if (!room) throw new Error(CodingErrorMessage.WorkspaceNotFound);
  const profile = registry.get(input.profileId);
  if (!profile) throw new Error(CodingErrorMessage.ProfileNotFound);
  const canProbe =
    profile.driverKind === CodingAgentDriverKind.Acp &&
    profile.status === CodingAgentProfileStatus.Detected;
  if (profile.status !== CodingAgentProfileStatus.Ready && !canProbe) {
    if (profile.id === CodingAgentProfileId.Builtin) {
      throw new Error(
        `${CodingErrorDetailMessage.AgentNotReadyDetail} Enable the unified model service and choose a default model in model settings before starting a task.`,
      );
    }
    throw new Error(CodingErrorMessage.ProfileNotReady);
  }
  const sourceRoot = path.resolve(input.sourceRoot);
  if (!repository.listWorkspaceSources(room.id).some(source => source.path === sourceRoot)) {
    throw new Error(CodingErrorMessage.SourceFolderNotInWorkspace);
  }
  return { room, profile, sourceRoot };
};

export const persistCodingSessionRecord = (input: {
  repository: CodingRoomRepository;
  target: ResolvedSessionTarget;
  title: string;
  laneId?: string;
  localSessionId?: string;
  modelOverride?: string | null;
  gitBaseline: string | null;
  driverSession?: CodingAgentSession;
  generatedTitle?: string | null;
}): CodingAgentLane => {
  const { repository, target, driverSession } = input;
  return repository.getDatabase().transaction(() => {
    const mission = repository.createMission(
      target.room.id,
      input.title.trim() || t('codingAgentDefaultMissionTitle'),
      input.gitBaseline,
    );
    const lane = repository.createLane(
      mission.id,
      target.profile.id,
      target.sourceRoot,
      target.sourceRoot,
      input.laneId,
      input.localSessionId,
      input.modelOverride ?? null,
    );
    repository.createAssignment({
      missionId: mission.id,
      laneId: lane.id,
      title: mission.title,
      instructions: mission.goal,
      workflowStage: CodingWorkflowStage.Implementation,
    });
    repository.setActive(target.room.id, mission.id, lane.id);
    if (driverSession) {
      repository.updateLaneRemoteSession(lane.id, driverSession.remoteSessionId);
      repository.updateLaneConfigOptions(lane.id, driverSession.configOptions);
      repository.updateLaneAvailableCommands(lane.id, driverSession.availableCommands);
    }
    if (input.generatedTitle) repository.updateMissionTitle(mission.id, input.generatedTitle);
    return lane;
  })();
};

const disposeUnboundDriver = async (
  pool: CodingDriverPool,
  laneId: string,
  driver: CodingAgentDriver,
  sessionId: string | null,
): Promise<void> => {
  if (sessionId && pool.driverFor(laneId) === driver) {
    try {
      await driver.disposeSession(sessionId);
    } catch {
      // The session was never published, so local cleanup can continue.
    }
  }
  try {
    await pool.retire(laneId);
  } catch {
    // The session was never published, so local cleanup can continue.
  }
};

export const prepareCodingSession = async (input: {
  request: StartCodingSessionInput;
  prompt: string;
  repository: CodingRoomRepository;
  registry: CodingAgentRegistry;
  driverFactory: CodingDriverFactory;
  driverPool: CodingDriverPool;
  validateBuiltinModel?: () => Promise<void>;
  getWorkspaceBaseline: (sourceRoot: string) => Promise<string | null>;
}): Promise<PreparedCodingSession> => {
  const { driverPool } = input;
  driverPool.assertOpen();
  const target = resolveSessionTarget(input.repository, input.registry, input.request);
  if (target.profile.driverKind === CodingAgentDriverKind.Builtin && !input.request.modelOverride) {
    await input.validateBuiltinModel?.();
  }
  driverPool.assertOpen();

  const laneId = randomUUID();
  const localSessionId = randomUUID();
  const driver = input.driverFactory.create(target.profile);
  driverPool.register(laneId, driver, target.profile.id);
  let generatedTitle: string | null = null;
  const removeTitleListener = driver.onSessionTitleChanged((_sessionId, title) => {
    generatedTitle = title;
  });
  let driverSession: CodingAgentSession;
  try {
    driverSession = await driver.createSession({
      workspaceRoot: target.sourceRoot,
      localSessionId,
    });
    const overrides = input.request.configOptionOverrides;
    if (overrides) {
      for (const [configId, value] of Object.entries(overrides)) {
        try {
          driverSession = {
            ...driverSession,
            configOptions: await driver.setConfigOption(driverSession.id, configId, value),
          };
        } catch (error) {
          console.warn('[CodingSession] Ignoring invalid config option override:', error);
        }
      }
    }
  } catch (error) {
    const metadata = driver.getProfileMetadata?.();
    await disposeUnboundDriver(driverPool, laneId, driver, null);
    driverPool.assertOpen();
    // When the agent rejects session creation because authentication is
    // required (e.g. Kimi Code CLI "Authentication required"), surface that
    // state immediately instead of leaving the profile stuck at Ready.
    if (metadata && target.profile.status === CodingAgentProfileStatus.Detected) {
      input.registry.recordFirstSessionCheck(target.profile, metadata, { success: false, error });
    } else if (
      target.profile.driverKind === CodingAgentDriverKind.Acp &&
      isAcpAuthenticationRequired(error)
    ) {
      input.registry.markNeedsAuth(target.profile.id);
    }
    throw error;
  } finally {
    removeTitleListener();
  }

  try {
    const gitBaseline = await input.getWorkspaceBaseline(target.sourceRoot);
    driverPool.assertOpen();
    const lane = persistCodingSessionRecord({
      repository: input.repository,
      target,
      title:
        input.request.title?.trim() ||
        buildSessionTitleFromInput(input.prompt, t('codingAgentDefaultMissionTitle')),
      laneId,
      localSessionId,
      modelOverride: input.request.modelOverride,
      gitBaseline,
      driverSession,
      generatedTitle,
    });
    return { ...target, lane, driver, driverSession };
  } catch (error) {
    await disposeUnboundDriver(driverPool, laneId, driver, driverSession.id);
    throw error;
  }
};
