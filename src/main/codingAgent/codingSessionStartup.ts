import { randomUUID } from 'crypto';
import path from 'path';

import { buildSessionTitleFromInput } from '../../common/sessionTitle';
import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  CodingWorkflowStage,
  type CodingAgentLane,
  type CodingAgentProfile,
  type CodingRoom,
  type CreateCodingSessionInput,
  type StartCodingSessionInput,
} from '../../shared/codingAgent';
import { t } from '../i18n';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { CodingRoomRepository } from './codingRoomRepository';
import type { CodingAgentDriver, CodingAgentSession } from './drivers/codingAgentDriver';
import { CodingDriverFactory } from './drivers/driverFactory';

export interface ResolvedSessionTarget {
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

export const resolveSessionTarget = (
  repository: CodingRoomRepository,
  registry: CodingAgentRegistry,
  input: CreateCodingSessionInput,
): ResolvedSessionTarget => {
  registry.refreshBuiltinReadiness();
  const room = repository.getRoomById(input.workspaceId);
  if (!room) throw new Error('Coding workspace was not found.');
  const profile = registry.get(input.profileId);
  if (!profile) throw new Error('Coding agent profile was not found.');
  if (profile.status !== CodingAgentProfileStatus.Ready) {
    throw new Error('The selected coding agent is not ready to run.');
  }
  const sourceRoot = path.resolve(input.sourceRoot);
  if (!repository.listWorkspaceSources(room.id).some(source => source.path === sourceRoot)) {
    throw new Error('The selected source folder does not belong to this coding workspace.');
  }
  return { room, profile, sourceRoot };
};

export const persistCodingSessionRecord = async (input: {
  repository: CodingRoomRepository;
  target: ResolvedSessionTarget;
  title: string;
  laneId?: string;
  localSessionId?: string;
  getWorkspaceBaseline: (sourceRoot: string) => Promise<string | null>;
}): Promise<CodingAgentLane> => {
  const { repository, target } = input;
  const mission = repository.createMission(
    target.room.id,
    input.title.trim() || t('codingAgentDefaultMissionTitle'),
    await input.getWorkspaceBaseline(target.sourceRoot),
  );
  try {
    const lane = repository.createLane(
      mission.id,
      target.profile.id,
      target.sourceRoot,
      target.sourceRoot,
      input.laneId,
      input.localSessionId,
    );
    repository.createAssignment({
      missionId: mission.id,
      laneId: lane.id,
      title: mission.title,
      instructions: mission.goal,
      workflowStage: CodingWorkflowStage.Implementation,
    });
    repository.setActive(target.room.id, mission.id, lane.id);
    return lane;
  } catch (error) {
    repository.deleteMission(target.room.id, mission.id);
    throw error;
  }
};

const disposeUnboundDriver = async (
  driver: CodingAgentDriver,
  sessionId: string | null,
): Promise<void> => {
  if (sessionId) {
    try {
      await driver.disposeSession(sessionId);
    } catch {
      // The session was never published, so local cleanup can continue.
    }
  }
  try {
    await driver.dispose();
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
  validateBuiltinModel?: () => Promise<void>;
  getWorkspaceBaseline: (sourceRoot: string) => Promise<string | null>;
}): Promise<PreparedCodingSession> => {
  const target = resolveSessionTarget(input.repository, input.registry, input.request);
  if (target.profile.driverKind === CodingAgentDriverKind.Builtin) {
    await input.validateBuiltinModel?.();
  }

  const laneId = randomUUID();
  const localSessionId = randomUUID();
  const driver = input.driverFactory.create(target.profile);
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
  } catch (error) {
    await disposeUnboundDriver(driver, null);
    throw error;
  } finally {
    removeTitleListener();
  }

  let lane: CodingAgentLane | null = null;
  try {
    lane = await persistCodingSessionRecord({
      repository: input.repository,
      target,
      title:
        input.request.title?.trim() ||
        buildSessionTitleFromInput(input.prompt, t('codingAgentDefaultMissionTitle')),
      laneId,
      localSessionId,
      getWorkspaceBaseline: input.getWorkspaceBaseline,
    });
    input.repository.updateLaneRemoteSession(lane.id, driverSession.remoteSessionId);
    input.repository.updateLaneConfigOptions(lane.id, driverSession.configOptions);
    input.repository.updateLaneAvailableCommands(lane.id, driverSession.availableCommands);
    if (generatedTitle) input.repository.updateMissionTitle(lane.missionId, generatedTitle);
    return { ...target, lane, driver, driverSession };
  } catch (error) {
    if (lane) input.repository.deleteMission(target.room.id, lane.missionId);
    await disposeUnboundDriver(driver, driverSession.id);
    throw error;
  }
};
