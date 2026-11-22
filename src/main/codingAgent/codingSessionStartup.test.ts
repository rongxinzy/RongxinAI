import path from 'path';

import { expect, test, vi } from 'vitest';

import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  type CodingAgentConfigOption,
} from '../../shared/codingAgent';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { CodingRoomRepository } from './codingRoomRepository';
import { openCodingRoomDatabase } from './codingRoomServiceTestHarness';
import { prepareCodingSession } from './codingSessionStartup';
import { CodingDriverPool } from './codingRoom/codingDriverPool';
import type { CodingAgentDriver } from './drivers/codingAgentDriver';
import { CodingDriverFactory } from './drivers/driverFactory';

// Use path.resolve to match the actual behavior in resolveSessionTarget
const TEST_SOURCE_ROOT = path.resolve('/test');

const registerReadyAcp = (registry: CodingAgentRegistry) =>
  registry.registerExternal({
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
      supportsConfigOptions: true,
      supportsUsage: false,
      supportsElicitation: false,
    },
    authMethods: [],
    command: '/nonexistent',
    args: [],
  });

test('starts ACP without checking the built-in Pi model', async () => {
  const registry = new CodingAgentRegistry();
  const profile = registerReadyAcp(registry);
  const validateBuiltinModel = vi.fn().mockRejectedValue(new Error('Built-in model unavailable'));
  const driverFactory = new CodingDriverFactory(
    { start: async () => {}, cancel: async () => {} },
    {},
  );
  const createSession = vi.fn<CodingAgentDriver['createSession']>().mockResolvedValue({
    id: 'driver-session',
    remoteSessionId: 'native-session',
    configOptions: [],
    availableCommands: [],
  });
  const model: CodingAgentConfigOption = {
    id: 'model',
    name: 'Model',
    type: 'select',
    currentValue: 'native-model',
  };
  const setConfigOption = vi.fn<CodingAgentDriver['setConfigOption']>().mockResolvedValue([model]);
  driverFactory.create = () =>
    ({
      createSession,
      setConfigOption,
      onSessionTitleChanged: () => () => {},
    }) as unknown as CodingAgentDriver;

  const repository = new CodingRoomRepository(openCodingRoomDatabase());
  const room = repository.getOrCreateRoom(TEST_SOURCE_ROOT);
  const prepared = await prepareCodingSession({
    request: {
      workspaceId: room.id,
      sourceRoot: TEST_SOURCE_ROOT,
      profileId: profile.id,
      prompt: 'Test',
      configOptionOverrides: { model: 'native-model' },
    },
    prompt: 'Test',
    repository,
    registry,
    driverFactory,
    driverPool: new CodingDriverPool(),
    validateBuiltinModel,
    getWorkspaceBaseline: async () => null,
  });
  expect(createSession).toHaveBeenCalledOnce();
  expect(prepared.driverSession.remoteSessionId).toBe('native-session');
  expect(setConfigOption).toHaveBeenCalledExactlyOnceWith(
    'driver-session',
    'model',
    'native-model',
  );
  expect(prepared.driverSession.configOptions).toEqual([model]);
  expect(validateBuiltinModel).not.toHaveBeenCalled();
});

test('marks profile as NeedsAuth when ACP createSession fails with authentication error', async () => {
  const registry = new CodingAgentRegistry();
  const profile = registerReadyAcp(registry);
  const repository = new CodingRoomRepository(openCodingRoomDatabase());
  const room = repository.getOrCreateRoom(TEST_SOURCE_ROOT);
  const driverFactory = new CodingDriverFactory(
    { start: async () => {}, cancel: async () => {} },
    {},
  );
  driverFactory.create = () =>
    ({
      createSession: async () => {
        throw new Error('Authentication required');
      },
      onSessionTitleChanged: () => () => {},
      dispose: async () => {},
    }) as unknown as CodingAgentDriver;

  await expect(
    prepareCodingSession({
      request: {
        workspaceId: room.id,
        sourceRoot: TEST_SOURCE_ROOT,
        profileId: profile.id,
        prompt: 'Test',
      },
      prompt: 'Test',
      repository,
      registry,
      driverFactory,
      driverPool: new CodingDriverPool(),
      getWorkspaceBaseline: async () => null,
    }),
  ).rejects.toThrow('Authentication required');

  expect(registry.get(profile.id)?.status).toBe(CodingAgentProfileStatus.NeedsAuth);
});

test('does not mark profile as NeedsAuth for non-auth errors', async () => {
  const registry = new CodingAgentRegistry();
  const profile = registerReadyAcp(registry);

  const repository = new CodingRoomRepository(openCodingRoomDatabase());
  const room = repository.getOrCreateRoom(TEST_SOURCE_ROOT);
  const driverFactory = new CodingDriverFactory(
    { start: async () => {}, cancel: async () => {} },
    {},
  );
  driverFactory.create = () =>
    ({
      createSession: async () => {
        throw new Error('Some other error');
      },
      onSessionTitleChanged: () => () => {},
      dispose: async () => {},
    }) as unknown as CodingAgentDriver;

  await expect(
    prepareCodingSession({
      request: {
        workspaceId: room.id,
        sourceRoot: TEST_SOURCE_ROOT,
        profileId: profile.id,
        prompt: 'Test',
      },
      prompt: 'Test',
      repository,
      registry,
      driverFactory,
      driverPool: new CodingDriverPool(),
      getWorkspaceBaseline: async () => null,
    }),
  ).rejects.toThrow('Some other error');

  expect(registry.get(profile.id)?.status).toBe(CodingAgentProfileStatus.Ready);
});

test('does not publish a lane when its workspace baseline finishes after shutdown', async () => {
  const registry = new CodingAgentRegistry();
  const profile = registerReadyAcp(registry);
  const repository = new CodingRoomRepository(openCodingRoomDatabase());
  const room = repository.getOrCreateRoom(TEST_SOURCE_ROOT);
  const createMission = vi.spyOn(repository, 'createMission');
  const driverFactory = new CodingDriverFactory(
    { start: async () => {}, cancel: async () => {} },
    {},
  );
  const dispose = vi.fn(async () => {});
  const disposeSession = vi.fn(async () => {});
  driverFactory.create = () =>
    ({
      createSession: async () => ({
        id: 'driver-session',
        remoteSessionId: 'native-session',
        configOptions: [],
        availableCommands: [],
      }),
      onSessionTitleChanged: () => () => {},
      dispose,
      disposeSession,
    }) as unknown as CodingAgentDriver;
  const driverPool = new CodingDriverPool();
  const baseline = Promise.withResolvers<string | null>();
  const getWorkspaceBaseline = vi.fn(() => baseline.promise);
  const starting = prepareCodingSession({
    request: {
      workspaceId: room.id,
      sourceRoot: TEST_SOURCE_ROOT,
      profileId: profile.id,
      prompt: 'Test',
    },
    prompt: 'Test',
    repository,
    registry,
    driverFactory,
    driverPool,
    getWorkspaceBaseline,
  });
  await vi.waitFor(() => expect(getWorkspaceBaseline).toHaveBeenCalledOnce());
  await driverPool.disposeAll();
  baseline.resolve(null);

  await expect(starting).rejects.toThrow('shutting down');
  expect(createMission).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledOnce();
  expect(disposeSession).not.toHaveBeenCalled();
});
