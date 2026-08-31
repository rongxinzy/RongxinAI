import path from 'path';

import { expect, test } from 'vitest';

import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  CodingWorkflowStage,
} from '../../shared/codingAgent';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { prepareCodingSession } from './codingSessionStartup';
import { CodingDriverFactory } from './drivers/driverFactory';

// Use path.resolve to match the actual behavior in resolveSessionTarget
const TEST_SOURCE_ROOT = path.resolve('/test');

const createMockRepository = () => ({
  getRoomById: (id: string) => ({
    id,
    name: 'Test Room',
    workspaceRoot: '/test',
    defaultProfileId: 'builtin-zhiyuan-coding',
    activeMissionId: null,
    activeLaneId: null,
  }),
  listWorkspaceSources: () => [
    { id: '1', workspaceId: 'room-1', path: TEST_SOURCE_ROOT, isPrimary: true },
  ],
  createMission: () => ({
    id: 'mission-1',
    roomId: 'room-1',
    title: 'Test',
    goal: 'Test',
    gitBaseline: null,
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }),
  createLane: () => ({
    id: 'lane-1',
    missionId: 'mission-1',
    profileId: 'profile-1',
    sourceRoot: '/test',
    executionRoot: '/test',
    configOptions: [],
    availableCommands: [],
    localSessionId: 'local-1',
    remoteSessionId: null,
    status: 'idle',
    draft: '',
    scrollPosition: 0,
    pendingRecoveryPrompt: null,
    pendingRecoveryContext: null,
  }),
  createAssignment: () => ({
    id: 'assignment-1',
    missionId: 'mission-1',
    laneId: 'lane-1',
    title: 'Test',
    instructions: 'Test',
    status: 'planned',
    workbenchTaskId: null,
    workbenchRunId: null,
    workflowStage: CodingWorkflowStage.Implementation,
    previousAssignmentId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }),
  setActive: () => {},
  updateLaneRemoteSession: () => {},
  updateLaneConfigOptions: () => {},
  updateLaneAvailableCommands: () => {},
  deleteMission: () => {},
});

test('marks profile as NeedsAuth when ACP createSession fails with authentication error', async () => {
  const registry = new CodingAgentRegistry();
  const profile = registry.registerExternal({
    name: 'Test ACP Agent',
    description: 'Test',
    driverKind: CodingAgentDriverKind.Acp,
    status: CodingAgentProfileStatus.Ready,
    capabilities: {
      supportsLoadSession: false,
      supportsResumeSession: false,
      supportsPlans: false,
      supportsPermissions: false,
      supportsFilesystem: false,
      supportsTerminal: false,
      supportsConfigOptions: false,
      supportsUsage: false,
      supportsElicitation: false,
    },
    authMethods: [],
    command: '/nonexistent',
    args: [],
  });

  const repository = createMockRepository() as any;
  const driverFactory = new CodingDriverFactory(
    { start: async () => {}, cancel: async () => {} },
    {},
  );
  driverFactory.create = () => ({
    createSession: async () => {
      throw new Error('Authentication required');
    },
    onSessionTitleChanged: () => () => {},
    dispose: async () => {},
  } as any);

  await expect(
    prepareCodingSession({
      request: {
        workspaceId: 'room-1',
        sourceRoot: '/test',
        profileId: profile.id,
        prompt: 'Test',
      },
      prompt: 'Test',
      repository,
      registry,
      driverFactory,
    }),
  ).rejects.toThrow('Authentication required');

  expect(registry.get(profile.id)?.status).toBe(CodingAgentProfileStatus.NeedsAuth);
});

test('does not mark profile as NeedsAuth for non-auth errors', async () => {
  const registry = new CodingAgentRegistry();
  const profile = registry.registerExternal({
    name: 'Test ACP Agent',
    description: 'Test',
    driverKind: CodingAgentDriverKind.Acp,
    status: CodingAgentProfileStatus.Ready,
    capabilities: {
      supportsLoadSession: false,
      supportsResumeSession: false,
      supportsPlans: false,
      supportsPermissions: false,
      supportsFilesystem: false,
      supportsTerminal: false,
      supportsConfigOptions: false,
      supportsUsage: false,
      supportsElicitation: false,
    },
    authMethods: [],
    command: '/nonexistent',
    args: [],
  });

  const repository = createMockRepository() as any;
  const driverFactory = new CodingDriverFactory(
    { start: async () => {}, cancel: async () => {} },
    {},
  );
  driverFactory.create = () => ({
    createSession: async () => {
      throw new Error('Some other error');
    },
    onSessionTitleChanged: () => () => {},
    dispose: async () => {},
  } as any);

  await expect(
    prepareCodingSession({
      request: {
        workspaceId: 'room-1',
        sourceRoot: '/test',
        profileId: profile.id,
        prompt: 'Test',
      },
      prompt: 'Test',
      repository,
      registry,
      driverFactory,
    }),
  ).rejects.toThrow('Some other error');

  expect(registry.get(profile.id)?.status).toBe(CodingAgentProfileStatus.Ready);
});
