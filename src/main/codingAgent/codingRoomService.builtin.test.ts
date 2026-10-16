import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { expect, test, vi } from 'vitest';

import {
  CodingAgentProfileId,
  CodingAssignmentStatus,
  CodingEventKind,
  CodingLaneStatus,
  CodingMissionStatus,
  type CodingAgentConfigOption,
} from '../../shared/codingAgent';
import { WorkbenchApprovalMode } from '../../shared/workbenchTask';
import { PiThinkingLevel } from '../libs/agentEngine/piRuntimeTypes';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { CodingRoomRepository } from './codingRoomRepository';
import { BuiltinCodingConfigId } from './drivers/builtinCodingDriver';
import {
  createService,
  openCodingRoomDatabase,
  trackTempDirectory,
} from './codingRoomServiceTestHarness';

test('routes a builtin lane through its driver and projects runtime completion', async () => {
  const db = openCodingRoomDatabase();
  const startBuiltinSession = vi.fn(async () => undefined);
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
    title: 'Fix refresh flow',
  });
  const lane = created.lanes[0];
  expect(created.assignments).toEqual([
    expect.objectContaining({ laneId: lane.id, status: CodingAssignmentStatus.Planned }),
  ]);
  await service.prompt(workspaceRoot, { laneId: lane.id, prompt: 'Investigate the failure.' });
  await Promise.resolve();

  expect(startBuiltinSession).toHaveBeenCalledWith({
    sessionId: lane.localSessionId,
    workspaceRoot,
    prompt: 'Investigate the failure.',
    thinkingLevel: PiThinkingLevel.Medium,
    permissionMode: WorkbenchApprovalMode.Ask,
  });
  service.recordBuiltinEvent(lane.localSessionId, CodingEventKind.TurnComplete, {});

  const snapshot = service.bootstrap(workspaceRoot);
  expect(snapshot.lanes[0].status).toBe(CodingLaneStatus.Completed);
  expect(snapshot.missions[0].status).toBe(CodingMissionStatus.NeedsReview);
  expect(snapshot.assignments[0].status).toBe(CodingAssignmentStatus.NeedsReview);
  expect(snapshot.events.map(event => event.kind)).toEqual([
    CodingEventKind.Message,
    CodingEventKind.TurnComplete,
  ]);
});

test('advertises the builtin commands for a lane whose row predates them', async () => {
  const db = openCodingRoomDatabase();
  const startBuiltinSession = vi.fn(async () => undefined);
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
    title: 'Legacy lane',
  });
  const lane = created.lanes[0];
  // Lanes created before the built-in agent advertised commands only have the
  // persisted empty snapshot.
  expect(created.lanes[0].availableCommands).toEqual([]);

  const snapshot = await service.prepareLane(workspaceRoot, lane.id);

  expect(snapshot.lanes[0].availableCommands.map(command => command.name)).toEqual([
    'plan',
    'goal',
    'compact',
    'status',
    'mcp',
  ]);
});

test('refreshes stale builtin commands and config options when the lane is prepared', async () => {
  const db = openCodingRoomDatabase();
  const repository = new CodingRoomRepository(db);
  const service = createService(repository, new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
    title: 'Stale lane',
  });
  const lane = created.lanes[0];
  // A lane written by an older build keeps retired commands and the config
  // options that predate planning mode, including the user's own selections.
  const legacyOptions: CodingAgentConfigOption[] = [
    {
      id: BuiltinCodingConfigId.ThinkingLevel,
      name: 'Thinking level',
      type: 'select',
      currentValue: PiThinkingLevel.High,
      options: [{ value: PiThinkingLevel.High, name: 'High' }],
    },
    {
      id: BuiltinCodingConfigId.PermissionMode,
      name: 'Permission mode',
      type: 'select',
      currentValue: WorkbenchApprovalMode.AllowAll,
    },
  ];
  repository.updateLaneConfigOptions(lane.id, legacyOptions);
  repository.updateLaneAvailableCommands(lane.id, [
    { name: 'compact', description: 'Compress the current session.' },
  ]);

  const snapshot = await service.prepareLane(workspaceRoot, lane.id);

  expect(snapshot.lanes[0].availableCommands.map(command => command.name)).toEqual([
    'plan',
    'goal',
    'compact',
    'status',
    'mcp',
  ]);
  expect(snapshot.lanes[0].configOptions).toEqual([
    expect.objectContaining({
      id: BuiltinCodingConfigId.ThinkingLevel,
      currentValue: PiThinkingLevel.High,
    }),
    expect.objectContaining({
      id: BuiltinCodingConfigId.PermissionMode,
      currentValue: WorkbenchApprovalMode.AllowAll,
    }),
    expect.objectContaining({ id: BuiltinCodingConfigId.PlanMode }),
  ]);
});

test('re-projects builtin commands for an already bound lane on the next prompt', async () => {
  const db = openCodingRoomDatabase();
  const startBuiltinSession = vi.fn(async () => undefined);
  const repository = new CodingRoomRepository(db);
  const service = createService(repository, new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
    title: 'Bound lane',
  });
  const lane = created.lanes[0];
  await service.prompt(workspaceRoot, { laneId: lane.id, prompt: 'First turn' });
  await Promise.resolve();
  service.recordBuiltinEvent(lane.localSessionId, CodingEventKind.TurnComplete, {});
  // Simulate a row that lost its command snapshot while the driver session
  // stays bound, which is the state legacy lanes are in.
  repository.updateLaneAvailableCommands(lane.id, []);

  await service.prompt(workspaceRoot, { laneId: lane.id, prompt: 'Second turn' });
  await Promise.resolve();

  expect(service.bootstrap(workspaceRoot).lanes[0].availableCommands.map(c => c.name)).toEqual([
    'plan',
    'goal',
    'compact',
    'status',
    'mcp',
  ]);
});

test('forwards the goal command to the builtin runtime as goal mode', async () => {
  const db = openCodingRoomDatabase();
  const startBuiltinSession = vi.fn(async () => undefined);
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
    title: 'Ship the migration',
  });
  const lane = created.lanes[0];

  await service.prompt(workspaceRoot, {
    laneId: lane.id,
    prompt: '/goal ship the migration end to end',
  });
  await Promise.resolve();

  expect(startBuiltinSession).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: lane.localSessionId,
      prompt: 'ship the migration end to end',
      goalMode: true,
    }),
  );
});

test('forwards the plan command to the builtin runtime as a planning turn', async () => {
  const db = openCodingRoomDatabase();
  const startBuiltinSession = vi.fn(async () => undefined);
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
    title: 'Plan the migration',
  });
  const lane = created.lanes[0];

  await service.prompt(workspaceRoot, {
    laneId: lane.id,
    prompt: '/plan migrate the auth flow',
  });
  await Promise.resolve();

  expect(startBuiltinSession).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: lane.localSessionId,
      prompt: 'migrate the auth flow',
      planMode: true,
    }),
  );
});

test('applies draft config option overrides when starting a builtin session', async () => {
  const db = openCodingRoomDatabase();
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-overrides-'));
  trackTempDirectory(root);
  const startBuiltinSession = vi.fn(async () => undefined);
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });

  const [workspace] = service.createWorkspace({
    name: 'Product',
    sourceFolders: [root],
    defaultProfileId: CodingAgentProfileId.Builtin,
  });
  const snapshot = await service.startSession({
    workspaceId: workspace.id,
    sourceRoot: root,
    profileId: CodingAgentProfileId.Builtin,
    prompt: 'Fix the bug.',
    configOptionOverrides: { [BuiltinCodingConfigId.ThinkingLevel]: PiThinkingLevel.High },
  });

  const lane = snapshot.lanes[0];
  expect(lane.configOptions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: BuiltinCodingConfigId.ThinkingLevel,
        currentValue: PiThinkingLevel.High,
      }),
    ]),
  );
  await Promise.resolve();
  expect(startBuiltinSession).toHaveBeenCalledWith(
    expect.objectContaining({ thinkingLevel: PiThinkingLevel.High }),
  );
});

test('ignores invalid draft config option overrides instead of failing the session', async () => {
  const db = openCodingRoomDatabase();
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-overrides-'));
  trackTempDirectory(root);
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });

  const [workspace] = service.createWorkspace({
    name: 'Product',
    sourceFolders: [root],
    defaultProfileId: CodingAgentProfileId.Builtin,
  });
  const snapshot = await service.startSession({
    workspaceId: workspace.id,
    sourceRoot: root,
    profileId: CodingAgentProfileId.Builtin,
    prompt: 'Fix the bug.',
    configOptionOverrides: { [BuiltinCodingConfigId.ThinkingLevel]: 'ludicrous' },
  });

  expect(snapshot.lanes[0].configOptions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: BuiltinCodingConfigId.ThinkingLevel,
        currentValue: PiThinkingLevel.Medium,
      }),
    ]),
  );
});

test('prepareLane populates config options for legacy builtin lanes', async () => {
  const db = openCodingRoomDatabase();
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-prepare-'));
  trackTempDirectory(root);
  const repository = new CodingRoomRepository(db);
  const service = createService(repository, new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });

  const [workspace] = service.createWorkspace({
    name: 'Product',
    sourceFolders: [root],
    defaultProfileId: CodingAgentProfileId.Builtin,
  });
  const created = await service.createSession({
    workspaceId: workspace.id,
    sourceRoot: root,
    profileId: CodingAgentProfileId.Builtin,
    title: 'Legacy task',
  });
  const lane = created.lanes[0];
  // Simulate a lane persisted before config option support existed.
  repository.updateLaneConfigOptions(lane.id, []);

  const snapshot = await service.prepareLane(root, lane.id);

  expect(snapshot.lanes[0].configOptions).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: BuiltinCodingConfigId.ThinkingLevel })]),
  );
});

test('getProfileConfigOptions returns defaults for the builtin profile only', () => {
  const db = openCodingRoomDatabase();
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });

  const options = service.getProfileConfigOptions(CodingAgentProfileId.Builtin);
  expect(options).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: BuiltinCodingConfigId.ThinkingLevel })]),
  );
  expect(service.getProfileConfigOptions('unknown-profile')).toEqual([]);
});

test('getProfileAvailableCommands returns the builtin command list without a session', () => {
  const db = openCodingRoomDatabase();
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });

  const names = service
    .getProfileAvailableCommands(CodingAgentProfileId.Builtin)
    .map(command => command.name);
  expect(names).toContain('plan');
  expect(names).toContain('mcp');
  expect(service.getProfileAvailableCommands('unknown-profile')).toEqual([]);
});
