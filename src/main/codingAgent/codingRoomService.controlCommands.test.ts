import { expect, test, vi } from 'vitest';

import { CodingAgentProfileId, CodingEventKind } from '../../shared/codingAgent';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { CodingRoomRepository } from './codingRoomRepository';
import { BuiltinCodingControlCommand } from './drivers/builtinCodingCommands';
import { createService, openCodingRoomDatabase } from './codingRoomServiceTestHarness';

test('runs builtin control commands locally instead of forwarding them to the agent', async () => {
  const db = openCodingRoomDatabase();
  const startBuiltinSession = vi.fn(async () => undefined);
  const compactBuiltinSession = vi.fn(async () => ({ cancelled: false }));
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession,
    compactBuiltinSession,
    isBuiltinSessionRunning: () => false,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/commands';
  const created = await service.createMission({
    workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
  });
  const lane = created.lanes[0];
  const prepared = await service.prepareLane(workspaceRoot, lane.id);
  expect(prepared.lanes[0].availableCommands.map(command => command.name)).toEqual([
    'plan',
    'goal',
    BuiltinCodingControlCommand.Compact,
    BuiltinCodingControlCommand.Status,
    BuiltinCodingControlCommand.Mcp,
  ]);

  await service.prompt(workspaceRoot, {
    laneId: lane.id,
    prompt: `/${BuiltinCodingControlCommand.Status}`,
  });
  await service.prompt(workspaceRoot, {
    laneId: lane.id,
    prompt: `/${BuiltinCodingControlCommand.Compact}`,
  });

  expect(startBuiltinSession).not.toHaveBeenCalled();
  expect(compactBuiltinSession).toHaveBeenCalledWith(lane.localSessionId);
  const events = service.bootstrap(workspaceRoot).events;
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: CodingEventKind.Message,
        payload: expect.objectContaining({ role: 'system' }),
      }),
    ]),
  );
  expect(events.some(event => event.payload.role === 'user')).toBe(false);
});

test('answers the mcp command from the runtime instead of the agent', async () => {
  const db = openCodingRoomDatabase();
  const startBuiltinSession = vi.fn(async () => undefined);
  const describeBuiltinMcp = vi.fn((target?: string) => ({
    gatewayAvailable: true,
    target: target ?? null,
    servers: [{ name: 'github', enabled: true, connected: true, toolCount: 1 }],
    tools: [{ server: 'github', name: 'create_issue' }],
  }));
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession,
    describeBuiltinMcp,
    isBuiltinSessionRunning: () => false,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/mcp-command';
  const created = await service.createMission({
    workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
  });
  await service.prepareLane(workspaceRoot, created.lanes[0].id);
  await service.prompt(workspaceRoot, {
    laneId: created.lanes[0].id,
    prompt: `/${BuiltinCodingControlCommand.Mcp}`,
  });
  await service.prompt(workspaceRoot, {
    laneId: created.lanes[0].id,
    prompt: `/${BuiltinCodingControlCommand.Mcp} github`,
  });

  expect(startBuiltinSession).not.toHaveBeenCalled();
  // A bare command reports on everything; the menu narrows it to one server.
  expect(describeBuiltinMcp).toHaveBeenNthCalledWith(1, undefined);
  expect(describeBuiltinMcp).toHaveBeenNthCalledWith(2, 'github');
  const events = service.bootstrap(workspaceRoot).events;
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: CodingEventKind.Message,
        payload: expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('create_issue'),
        }),
      }),
    ]),
  );
  expect(events.some(event => event.payload.role === 'user')).toBe(false);
});

test('treats a too-small builtin compaction as a no-op instead of a failure', async () => {
  const db = openCodingRoomDatabase();
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    compactBuiltinSession: async () => {
      throw new Error('Nothing to compact (session too small)');
    },
    isBuiltinSessionRunning: () => false,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/compact-noop';
  const created = await service.createMission({
    workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
  });

  await service.prompt(workspaceRoot, {
    laneId: created.lanes[0].id,
    prompt: `/${BuiltinCodingControlCommand.Compact}`,
  });

  const event = service.bootstrap(workspaceRoot).events.at(-1);
  expect(event?.payload.content).toBe('当前会话内容不足，无需压缩。');
});

test('reports a missing builtin session instead of failing to compact', async () => {
  const db = openCodingRoomDatabase();
  const compactBuiltinSession = vi.fn(async () => ({ cancelled: false }));
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    compactBuiltinSession,
    isBuiltinSessionRunning: () => false,
    isBuiltinSessionActive: () => false,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/compact-no-session';
  const created = await service.createMission({
    workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
  });

  await service.prompt(workspaceRoot, {
    laneId: created.lanes[0].id,
    prompt: `/${BuiltinCodingControlCommand.Compact}`,
  });

  expect(compactBuiltinSession).not.toHaveBeenCalled();
  const event = service.bootstrap(workspaceRoot).events.at(-1);
  expect(event?.payload.content).toBe('当前没有可压缩的会话上下文。');
});

test('queues a builtin control command while the session is running', async () => {
  const db = openCodingRoomDatabase();
  const compactBuiltinSession = vi.fn(async () => ({ cancelled: false }));
  let queued: (() => Promise<void>) | null = null;
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    compactBuiltinSession,
    isBuiltinSessionRunning: () => true,
    enqueueBuiltinControlAction: (_sessionId, action) => {
      queued = action;
      return { success: true };
    },
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/queued-command';
  const created = await service.createMission({
    workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
  });
  const lane = created.lanes[0];

  await service.prompt(workspaceRoot, {
    laneId: lane.id,
    prompt: `/${BuiltinCodingControlCommand.Compact}`,
  });
  expect(compactBuiltinSession).not.toHaveBeenCalled();

  await queued!();
  expect(compactBuiltinSession).toHaveBeenCalledWith(lane.localSessionId);
});
