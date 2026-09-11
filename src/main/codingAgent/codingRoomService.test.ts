import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execPath } from 'process';
import { afterEach, expect, test, vi } from 'vitest';

import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  CodingAgentProfileId,
  CodingAssignmentStatus,
  CodingElicitationStatus,
  CodingEventKind,
  CodingLaneStatus,
  CodingMissionStatus,
  CodingPermissionOutcome,
  CodingWorkflowStage,
  type CodingAgentConfigOption,
} from '../../shared/codingAgent';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { CodingRoomRepository } from './codingRoomRepository';
import { CodingRoomService } from './codingRoomService';
import { initializeCodingAgentSchema } from './schema';
import { AcpSessionUpdateKind } from './acp/protocol';
import { PiThinkingLevel } from '../libs/agentEngine/piRuntimeTypes';
import { WorkbenchApprovalMode } from '../../shared/workbenchTask';
import { BuiltinCodingConfigId } from './drivers/builtinCodingDriver';
import { BuiltinCodingControlCommand } from './drivers/builtinCodingCommands';
import { CoworkInterruptionCause } from '../../shared/cowork/interruption';

let db: Database.Database | undefined;
const tempDirectories: string[] = [];

afterEach(() => {
  db?.close();
  db = undefined;
  for (const directory of tempDirectories.splice(0)) {
    // Windows: a spawned fake-agent process can still hold the temp dir at teardown.
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});

test('creates workspace-scoped sessions with immutable agent and source bindings', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-workspace-'));
  const primaryRoot = path.join(root, 'app');
  const sharedRoot = path.join(root, 'shared');
  mkdirSync(primaryRoot);
  mkdirSync(sharedRoot);
  tempDirectories.push(root);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });

  const [workspace] = service.createWorkspace({
    name: 'Product',
    sourceFolders: [primaryRoot, sharedRoot],
    defaultProfileId: CodingAgentProfileId.Builtin,
  });
  const snapshot = await service.createSession({
    workspaceId: workspace.id,
    sourceRoot: sharedRoot,
    profileId: 'builtin-zhiyuan-coding',
    title: 'Fix shared package',
  });

  expect(snapshot.room).toMatchObject({ id: workspace.id, name: 'Product' });
  expect(workspace.defaultProfileId).toBe(CodingAgentProfileId.Builtin);
  expect(snapshot.lanes[0]).toMatchObject({
    profileId: 'builtin-zhiyuan-coding',
    sourceRoot: sharedRoot,
    executionRoot: sharedRoot,
  });
  expect(service.listWorkspaces()[0].sessions[0]).toMatchObject({
    title: 'Fix shared package',
    profileId: 'builtin-zhiyuan-coding',
    sourceRoot: sharedRoot,
  });
  expect(() =>
    service.updateWorkspace({
      workspaceId: workspace.id,
      name: 'Renamed product',
      sourceFolders: [primaryRoot],
      defaultProfileId: CodingAgentProfileId.Builtin,
    }),
  ).toThrow('cannot be removed');
});

test('does not persist a draft session when its default agent model is unavailable', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-unavailable-'));
  tempDirectories.push(root);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
    validateBuiltinModel: async () => {
      throw new Error('Configured model is unavailable.');
    },
  });
  const [workspace] = service.createWorkspace({
    name: 'Unavailable model',
    sourceFolders: [root],
    defaultProfileId: CodingAgentProfileId.Builtin,
  });

  await expect(
    service.startSession({
      workspaceId: workspace.id,
      sourceRoot: root,
      profileId: workspace.defaultProfileId,
      prompt: 'Implement the first task.',
    }),
  ).rejects.toThrow('model is unavailable');

  expect(service.listWorkspaces()[0].sessions).toEqual([]);
  expect(service.bootstrap(root).missions).toEqual([]);
});

test('does not persist a session before an external ACP session is established', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-acp-failure-'));
  tempDirectories.push(root);
  const registry = new CodingAgentRegistry();
  registry.registerExternal({
    name: 'Unavailable ACP agent',
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
    command: execPath,
    args: [
      '-e',
      [
        "let buffer='';",
        "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);",
        "if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n');",
        "if (request.method === 'session/new') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { message: 'Agent model is unavailable.' } }) + '\\n');",
        '} });',
      ].join(''),
    ],
  });
  const service = new CodingRoomService(new CodingRoomRepository(db), registry, {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const profile = registry.list().find(candidate => !candidate.isBuiltin)!;
  const [workspace] = service.createWorkspace({
    name: 'Unavailable external agent',
    sourceFolders: [root],
    defaultProfileId: profile.id,
  });

  await expect(
    service.startSession({
      workspaceId: workspace.id,
      sourceRoot: root,
      profileId: profile.id,
      prompt: 'Implement the first task.',
    }),
  ).rejects.toThrow('Agent model is unavailable');

  expect(service.listWorkspaces()[0].sessions).toEqual([]);
  expect(service.bootstrap(root).missions).toEqual([]);
  await service.dispose();
});

test('routes a builtin lane through its driver and projects runtime completion', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const startBuiltinSession = vi.fn(async () => undefined);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
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
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const startBuiltinSession = vi.fn(async () => undefined);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
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
  ]);
});

test('refreshes stale builtin commands and config options when the lane is prepared', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const service = new CodingRoomService(repository, new CodingAgentRegistry(), {
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
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const startBuiltinSession = vi.fn(async () => undefined);
  const repository = new CodingRoomRepository(db);
  const service = new CodingRoomService(repository, new CodingAgentRegistry(), {
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
  ]);
});

test('forwards the goal command to the builtin runtime as goal mode', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const startBuiltinSession = vi.fn(async () => undefined);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
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
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const startBuiltinSession = vi.fn(async () => undefined);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
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

test('reacquires the workspace writer lease before resuming a builtin elicitation', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const respondBuiltinElicitation = vi.fn(() => true);
  const service = new CodingRoomService(repository, new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    respondBuiltinElicitation,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-elicitation-lease-'));
  tempDirectories.push(workspaceRoot);
  const [workspace] = service.createWorkspace({
    name: 'Elicitation lease',
    sourceFolders: [workspaceRoot],
    defaultProfileId: CodingAgentProfileId.Builtin,
  });
  const created = await service.startSession({
    workspaceId: workspace.id,
    sourceRoot: workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
    prompt: 'Implement the requested change.',
  });
  const lane = created.lanes[0];
  service.recordBuiltinElicitation(lane.localSessionId, {
    requestId: 'elicitation-lease',
    question: 'Which API version should I use?',
  });

  expect(repository.getWriterLease(created.room.id, lane.sourceRoot)).toBeNull();

  await service.respondElicitation(workspaceRoot, {
    requestId: 'elicitation-lease',
    answer: 'Use v2.',
  });

  expect(respondBuiltinElicitation).toHaveBeenCalledWith('elicitation-lease', 'Use v2.');
  expect(repository.getWriterLease(created.room.id, lane.sourceRoot)).toBe(lane.id);
});

test('blocks builtin prompts while an elicitation awaits an answer', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const startBuiltinSession = vi.fn(async () => undefined);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/elicitation-prompt-block';
  const created = await service.createMission({
    workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
    title: 'Await clarification',
  });
  const lane = created.lanes[0];
  await service.prompt(workspaceRoot, { laneId: lane.id, prompt: 'Start the work.' });
  await Promise.resolve();
  service.recordBuiltinElicitation(lane.localSessionId, {
    requestId: 'elicitation-block',
    question: 'Which endpoint should I change?',
  });
  startBuiltinSession.mockClear();

  await expect(
    service.prompt(workspaceRoot, { laneId: lane.id, prompt: 'Just continue anyway.' }),
  ).rejects.toThrow('请先回答或取消当前问题，再发送新消息。');
  expect(startBuiltinSession).not.toHaveBeenCalled();
});

test('cancels a stale question and frees its lane after an application restart', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/elicitation-restart';
  const created = await service.createMission({
    workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
    title: 'Resume after restart',
  });
  const lane = created.lanes[0];
  await service.prompt(workspaceRoot, { laneId: lane.id, prompt: 'Start the work.' });
  await Promise.resolve();
  service.recordBuiltinElicitation(lane.localSessionId, {
    requestId: 'elicitation-restart',
    question: 'Which endpoint should I change?',
  });
  expect(service.bootstrap(workspaceRoot).lanes[0].status).toBe(CodingLaneStatus.WaitingElicitation);

  // A restart drops the in-process Pi session but keeps the persisted question.
  expect(service.recoverInterruptedState()).toBe(1);

  const recovered = service.bootstrap(workspaceRoot);
  expect(recovered.lanes[0].status).toBe(CodingLaneStatus.Idle);
  expect(recovered.elicitations).toEqual([
    expect.objectContaining({
      status: CodingElicitationStatus.Cancelled,
      cancelReason: '应用已重启，因此取消了此问题。',
    }),
  ]);
  await expect(
    service.prompt(workspaceRoot, { laneId: lane.id, prompt: 'Continue the work.' }),
  ).resolves.toBeTruthy();
});

test('cancels a pending elicitation before stopping its session and blocks deletion while waiting', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const cancelBuiltinElicitation = vi.fn(() => true);
  const service = new CodingRoomService(repository, new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    cancelBuiltinElicitation,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-elicitation-cancel-'));
  tempDirectories.push(workspaceRoot);
  const [workspace] = service.createWorkspace({
    name: 'Elicitation cancellation',
    sourceFolders: [workspaceRoot],
    defaultProfileId: CodingAgentProfileId.Builtin,
  });
  const created = await service.startSession({
    workspaceId: workspace.id,
    sourceRoot: workspaceRoot,
    profileId: CodingAgentProfileId.Builtin,
    prompt: 'Implement the requested change.',
  });
  const lane = created.lanes[0];
  service.recordBuiltinElicitation(lane.localSessionId, {
    requestId: 'elicitation-cancel',
    question: 'Should I preserve the legacy endpoint?',
  });

  expect(() => service.deleteSession(workspaceRoot, lane.id)).toThrow(
    'Stop the running coding session',
  );
  expect(() => service.deleteWorkspace(workspace.id)).toThrow('Stop all running coding sessions');

  await service.cancel(workspaceRoot, lane.id);

  expect(cancelBuiltinElicitation).toHaveBeenCalledWith(
    'elicitation-cancel',
    '会话已停止，因此取消了此问题。',
  );
  expect(service.bootstrap(workspaceRoot).elicitations).toEqual([
    expect.objectContaining({ status: CodingElicitationStatus.Cancelled }),
  ]);
});

test('runs builtin control commands locally instead of forwarding them to the agent', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const startBuiltinSession = vi.fn(async () => undefined);
  const compactBuiltinSession = vi.fn(async () => ({ cancelled: false }));
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
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

test('treats a too-small builtin compaction as a no-op instead of a failure', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
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
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const compactBuiltinSession = vi.fn(async () => ({ cancelled: false }));
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
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
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const compactBuiltinSession = vi.fn(async () => ({ cancelled: false }));
  let queued: (() => Promise<void>) | null = null;
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
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

test('does not create a mission when the selected agent needs model configuration', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const service = new CodingRoomService(
    new CodingRoomRepository(db),
    new CodingAgentRegistry(undefined, () => false),
    {
      startBuiltinSession: async () => undefined,
      cancelBuiltinSession: async () => undefined,
      getBuiltinWorkbenchLink: () => null,
      beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
      completeExternalWorkbenchRun: () => undefined,
    },
  );

  await expect(
    service.createMission({
      workspaceRoot: '/workspace/project',
      profileId: 'builtin-zhiyuan-coding',
    }),
  ).rejects.toThrow('not ready');
});

test('rediscovers external agents on demand and returns the refreshed room snapshot', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const registry = new CodingAgentRegistry();
  const discoverExternalAgents = vi
    .spyOn(registry, 'discoverExternalAgents')
    .mockResolvedValue(undefined);
  const service = new CodingRoomService(new CodingRoomRepository(db), registry, {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });

  const snapshot = await service.discoverAgents('/workspace/project');

  expect(discoverExternalAgents).toHaveBeenCalledOnce();
  expect(snapshot.room.workspaceRoot).toBe('/workspace/project');
  expect(snapshot.profiles).toEqual([
    expect.objectContaining({ id: 'builtin-zhiyuan-coding', isBuiltin: true }),
  ]);
});

test('projects builtin permission requests into the coding room status', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const snapshot = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const lane = snapshot.lanes[0];
  service.recordBuiltinEvent(lane.localSessionId, CodingEventKind.Permission, {
    requestId: 'approval',
  });

  const updated = service.bootstrap(workspaceRoot);
  expect(updated.lanes[0].status).toBe(CodingLaneStatus.WaitingApproval);
  expect(updated.missions[0].status).toBe(CodingMissionStatus.WaitingApproval);
  expect(updated.assignments[0].status).toBe(CodingAssignmentStatus.WaitingApproval);
});

test('responds to builtin coding permissions through the in-process runtime', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const respondBuiltinPermission = vi.fn();
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
    respondBuiltinPermission,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const lane = created.lanes[0];
  service.recordBuiltinEvent(lane.localSessionId, CodingEventKind.Permission, {
    requestId: 'approval',
  });

  const result = await service.respondToPermission(workspaceRoot, {
    requestId: 'approval',
    outcome: CodingPermissionOutcome.Selected,
  });

  expect(respondBuiltinPermission).toHaveBeenCalledWith('approval', true);
  expect(result.lanes[0].status).toBe(CodingLaneStatus.Running);
  expect(result.events.at(-1)).toMatchObject({
    kind: CodingEventKind.ToolCall,
    payload: {
      permissionRequestId: 'approval',
      permissionOutcome: CodingPermissionOutcome.Selected,
    },
  });
});

test('pauses a builtin lane when its runtime reports a recoverable interruption', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const lane = created.lanes[0];
  service.recordBuiltinEvent(lane.localSessionId, CodingEventKind.Permission, {
    requestId: 'approval',
  });

  service.recordBuiltinInterruption({
    sessionId: lane.localSessionId,
    interruptionId: 'interruption-1',
    cause: CoworkInterruptionCause.ApprovalDenied,
    taskId: 'task',
    recoverable: true,
  });

  const updated = service.bootstrap(workspaceRoot);
  expect(updated.lanes[0].status).toBe(CodingLaneStatus.Idle);
  expect(updated.missions[0].status).toBe(CodingMissionStatus.NeedsReview);
  expect(updated.assignments[0].status).toBe(CodingAssignmentStatus.Planned);
  expect(updated.events.at(-1)).toMatchObject({
    kind: CodingEventKind.TurnCancelled,
    payload: { reason: CoworkInterruptionCause.ApprovalDenied },
  });
});

test('cancels a running turn and retains the mission and lane', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const cancelled: string[] = [];
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async sessionId => {
      cancelled.push(sessionId);
    },
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const lane = created.lanes[0];
  await service.prompt(workspaceRoot, {
    laneId: lane.id,
    prompt: 'Implement the change.',
  });
  const updated = await service.cancel(workspaceRoot, lane.id);

  expect(cancelled).toEqual([lane.localSessionId]);
  expect(updated.missions).toHaveLength(1);
  expect(updated.lanes).toHaveLength(1);
  expect(updated.lanes[0].status).toBe(CodingLaneStatus.Idle);
  expect(updated.events.at(-1)?.kind).toBe(CodingEventKind.TurnCancelled);
});

test('cancel leaves a lane without an active turn untouched', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const cancelled: string[] = [];
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async sessionId => {
      cancelled.push(sessionId);
    },
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const lane = created.lanes[0];
  const updated = await service.cancel(workspaceRoot, lane.id);

  expect(cancelled).toEqual([]);
  expect(updated.lanes[0].status).toBe(CodingLaneStatus.Idle);
  expect(updated.missions[0].status).toBe(CodingMissionStatus.Draft);
  expect(
    updated.events.filter(event => event.kind === CodingEventKind.TurnCancelled),
  ).toHaveLength(0);
});

test('reports a failed automatic collaboration stage without changing assignment state', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const repository = new CodingRoomRepository(db);
  const service = new CodingRoomService(repository, new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const sourceLane = created.lanes[0];
  const mission = created.missions[0];
  const sourceAssignment = created.assignments[0];
  // A mission created without a Git baseline makes the automatic handoff fail
  // deterministically when the completed turn triggers the next stage.
  const targetLane = repository.createLane(mission.id, 'builtin-zhiyuan-coding', workspaceRoot);
  repository.createAssignment({
    missionId: mission.id,
    laneId: targetLane.id,
    title: 'Verify',
    instructions: 'Verify the implementation.',
    workflowStage: CodingWorkflowStage.Verification,
    previousAssignmentId: sourceAssignment.id,
  });

  service.recordBuiltinEvent(sourceLane.localSessionId, CodingEventKind.TurnComplete, {});
  // The stage failure surfaces through an async rejection handler.
  await new Promise<void>(resolve => setImmediate(resolve));

  const updated = service.bootstrap(workspaceRoot);
  expect(updated.lanes.find(lane => lane.id === sourceLane.id)?.status).toBe(
    CodingLaneStatus.Completed,
  );
  expect(
    updated.assignments.find(assignment => assignment.laneId === targetLane.id)?.status,
  ).toBe(CodingAssignmentStatus.Planned);
  const sourceEvents = updated.events.filter(event => event.laneId === sourceLane.id);
  expect(sourceEvents.at(-1)).toMatchObject({
    kind: CodingEventKind.Message,
    payload: { role: 'system', error: expect.stringContaining('frozen baseline') },
  });
});

test('recovers stale running lanes after an application restart without losing the mission', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  await service.prompt(workspaceRoot, {
    laneId: created.lanes[0].id,
    prompt: 'Implement the change.',
  });

  expect(service.recoverInterruptedState()).toBe(1);
  const recovered = service.bootstrap(workspaceRoot);
  expect(recovered.missions[0].status).toBe(CodingMissionStatus.NeedsReview);
  expect(recovered.lanes[0].status).toBe(CodingLaneStatus.Idle);
  expect(recovered.events.at(-1)).toMatchObject({
    kind: CodingEventKind.TurnCancelled,
    payload: { reason: 'application_restart' },
  });
});

test('requires explicit confirmation before sending a recovery summary to a replacement ACP session', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const registry = new CodingAgentRegistry();
  registry.registerExternal({
    name: 'Test ACP agent',
    description: 'Test',
    driverKind: CodingAgentDriverKind.Acp,
    status: CodingAgentProfileStatus.Ready,
    capabilities: {
      supportsLoadSession: true,
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
    command: execPath,
    args: [
      '-e',
      "let buffer=''; process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1); if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n'); if (request.method === 'session/new') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'replacement-session' } }) + '\\n'); if (request.method === 'session/prompt') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } }) + '\\n'); } });",
    ],
  });
  const beginExternalWorkbenchRun = vi.fn(() => ({ taskId: 'task', runId: 'run' }));
  const service = new CodingRoomService(new CodingRoomRepository(db), registry, {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun,
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = process.cwd();
  const profile = registry.list().find(candidate => !candidate.isBuiltin)!;
  const created = await service.createMission({ workspaceRoot, profileId: profile.id });
  const lane = created.lanes[0];
  new CodingRoomRepository(db).updateLaneRemoteSession(lane.id, 'unavailable-session');

  const pending = await service.prompt(workspaceRoot, {
    laneId: lane.id,
    prompt: 'Continue the task.',
  });
  expect(pending.lanes[0]).toMatchObject({
    status: CodingLaneStatus.Idle,
    pendingRecoveryPrompt: 'Continue the task.',
  });
  expect(beginExternalWorkbenchRun).not.toHaveBeenCalled();

  await service.confirmSessionRecovery(workspaceRoot, lane.id, true);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(beginExternalWorkbenchRun).toHaveBeenCalledWith(
    expect.objectContaining({ goal: 'Continue the task.' }),
  );
});

test('prepares a new ACP lane and projects its dynamic commands before the first prompt', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const registry = new CodingAgentRegistry();
  const updateKind = JSON.stringify(AcpSessionUpdateKind.AvailableCommandsUpdate);
  registry.registerExternal({
    name: 'Command-aware ACP agent',
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
    command: execPath,
    args: [
      '-e',
      [
        "let buffer='';",
        "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);",
        "if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n');",
        `if (request.method === 'session/new') { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'command-session', update: { sessionUpdate: ${updateKind}, availableCommands: [{ name: 'mcp', description: 'List MCP tools.' }, { name: 'skills', description: 'List skills.' }] } } }) + '\\n'); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'command-session' } }) + '\\n'); }`,
        '} });',
      ].join(''),
    ],
  });
  const service = new CodingRoomService(new CodingRoomRepository(db), registry, {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = process.cwd();
  const profile = registry.list().find(candidate => !candidate.isBuiltin)!;
  const created = await service.createMission({ workspaceRoot, profileId: profile.id });

  const prepared = await service.prepareLane(workspaceRoot, created.lanes[0].id);

  expect(prepared.lanes[0]).toMatchObject({
    remoteSessionId: 'command-session',
    availableCommands: [
      { name: 'mcp', description: 'List MCP tools.' },
      { name: 'skills', description: 'List skills.' },
    ],
  });
  await service.dispose();
});

test('creates collaborator lanes in isolated workspaces and runs them independently', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const startBuiltinSession = vi.fn(async () => undefined);
  const createIsolatedWorkspace = vi.fn(
    async ({ laneId }: { laneId: string }) => `/isolated/${laneId}`,
  );
  const getWorkspaceBaseline = vi.fn(async () => 'base-commit');
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
    createIsolatedWorkspace,
    getWorkspaceBaseline,
  });
  const workspaceRoot = '/workspace/project';
  const initial = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const collaborator = await service.addLane(
    workspaceRoot,
    initial.missions[0].id,
    'builtin-zhiyuan-coding',
  );
  const lane = collaborator.lanes.find(candidate => candidate.id !== initial.lanes[0].id)!;

  expect(lane.executionRoot).toBe(`/isolated/${lane.id}`);
  expect(createIsolatedWorkspace).toHaveBeenCalledWith({
    workspaceRoot,
    laneId: lane.id,
    baseline: 'base-commit',
  });
  expect(getWorkspaceBaseline).toHaveBeenCalledTimes(1);
  await service.prompt(workspaceRoot, { laneId: lane.id, prompt: 'Review the implementation.' });
  await Promise.resolve();
  expect(startBuiltinSession).toHaveBeenCalledWith({
    sessionId: lane.localSessionId,
    workspaceRoot: lane.executionRoot,
    prompt: 'Review the implementation.',
    thinkingLevel: PiThinkingLevel.Medium,
    permissionMode: WorkbenchApprovalMode.Ask,
  });
});

test('previews and persists an immutable handoff with the source Git baseline', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const startBuiltinSession = vi.fn(async () => undefined);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
    createIsolatedWorkspace: async ({ laneId }) => `/isolated/${laneId}`,
    getWorkspaceBaseline: async workspaceRoot =>
      workspaceRoot === '/workspace/project' ? 'base-commit' : null,
    getWorkspaceDiff: async workspaceRoot =>
      workspaceRoot === '/workspace/project' ? 'diff --git a/file b/file' : null,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const source = created.lanes[0];
  const withCollaborator = await service.addLane(
    workspaceRoot,
    created.missions[0].id,
    'builtin-zhiyuan-coding',
  );
  const target = withCollaborator.lanes.find(lane => lane.id !== source.id)!;

  const preview = await service.previewHandoff(workspaceRoot, source.id, target.id);
  const result = await service.handoff(workspaceRoot, source.id, target.id);

  expect(preview).toMatchObject({
    baseline: 'base-commit',
    diff: 'diff --git a/file b/file',
    sourceLaneId: source.id,
  });
  expect(result.events.find(event => event.payload.role === 'handoff')).toMatchObject({
    laneId: target.id,
    kind: CodingEventKind.Message,
    payload: {
      role: 'handoff',
      content: expect.objectContaining({
        baseline: 'base-commit',
        diff: 'diff --git a/file b/file',
      }),
    },
  });
  expect(startBuiltinSession).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: target.localSessionId,
      workspaceRoot: target.executionRoot,
      prompt: expect.stringContaining('base-commit'),
    }),
  );
});

test('requires an isolated lane and an idle primary writer before applying collaborator changes', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const applyIsolatedWorkspaceDiff = vi.fn(async () => undefined);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
    createIsolatedWorkspace: async ({ laneId }) => `/isolated/${laneId}`,
    getIsolatedWorkspaceDiff: async () => 'diff --git a/file b/file',
    getWorkspaceBaseline: async () => 'base-commit',
    applyIsolatedWorkspaceDiff,
  });
  const workspaceRoot = '/workspace/project';
  const created = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });
  const primaryLane = created.lanes[0];
  const withCollaborator = await service.addLane(
    workspaceRoot,
    created.missions[0].id,
    'builtin-zhiyuan-coding',
  );
  const collaborator = withCollaborator.lanes.find(lane => lane.id !== primaryLane.id)!;

  await expect(service.previewLaneChanges(workspaceRoot, primaryLane.id)).rejects.toThrow(
    'isolated',
  );
  await expect(service.previewLaneChanges(workspaceRoot, collaborator.id)).resolves.toEqual({
    laneId: collaborator.id,
    diff: 'diff --git a/file b/file',
  });
  const result = await service.applyLaneChanges(workspaceRoot, collaborator.id);

  expect(applyIsolatedWorkspaceDiff).toHaveBeenCalledWith({
    workspaceRoot,
    isolatedWorkspaceRoot: collaborator.executionRoot,
  });
  expect(result.events.at(-1)).toMatchObject({
    laneId: collaborator.id,
    kind: CodingEventKind.FileChange,
    payload: { action: 'applied_to_workspace' },
  });
});

test('creates deterministic isolated review and verification assignments for a collaboration preset', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const startBuiltinSession = vi.fn(async () => undefined);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
    createIsolatedWorkspace: async ({ laneId }) => `/isolated/${laneId}`,
    getWorkspaceBaseline: async () => 'base-commit',
    getWorkspaceDiff: async () => 'diff --git a/file b/file',
    applyWorkspacePatch: async () => undefined,
  });
  const workspaceRoot = '/workspace/project';
  const initial = await service.createMission({
    workspaceRoot,
    profileId: 'builtin-zhiyuan-coding',
  });

  const result = await service.createImplementationReviewVerificationPreset({
    workspaceRoot,
    missionId: initial.missions[0].id,
    reviewerProfileId: 'builtin-zhiyuan-coding',
    verifierProfileId: 'builtin-zhiyuan-coding',
  });

  expect(result.lanes).toHaveLength(3);
  expect(result.assignments.map(assignment => assignment.title)).toEqual([
    initial.missions[0].title,
    `Review: ${initial.missions[0].title}`,
    `Verify: ${initial.missions[0].title}`,
  ]);
  expect(result.assignments.map(assignment => assignment.workflowStage)).toEqual([
    'implementation',
    'review',
    'verification',
  ]);
  expect(result.lanes.slice(1).every(lane => lane.executionRoot.startsWith('/isolated/'))).toBe(
    true,
  );
  expect(startBuiltinSession).not.toHaveBeenCalled();

  await service.prompt(workspaceRoot, { laneId: initial.lanes[0].id, prompt: 'Implement it.' });
  service.recordBuiltinEvent(initial.lanes[0].localSessionId, CodingEventKind.TurnComplete, {});
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(startBuiltinSession).toHaveBeenCalledTimes(2);
  expect(startBuiltinSession).toHaveBeenLastCalledWith(
    expect.objectContaining({
      sessionId: result.lanes[1].localSessionId,
      prompt: expect.stringContaining('diff --git'),
    }),
  );
  service.recordBuiltinEvent(result.lanes[1].localSessionId, CodingEventKind.TurnComplete, {});
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(startBuiltinSession).toHaveBeenCalledTimes(3);
  expect(startBuiltinSession).toHaveBeenLastCalledWith(
    expect.objectContaining({ sessionId: result.lanes[2].localSessionId }),
  );
});

test('deleteSession removes a collaborator lane but keeps the primary session', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-delete-'));
  tempDirectories.push(root);
  const repository = new CodingRoomRepository(db);
  const service = new CodingRoomService(repository, new CodingAgentRegistry(), {
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
  const snapshot = await service.createSession({
    workspaceId: workspace.id,
    sourceRoot: root,
    profileId: CodingAgentProfileId.Builtin,
    title: 'Main task',
  });
  const primaryLane = snapshot.lanes[0];
  const collaborator = repository.createLane(
    primaryLane.missionId,
    CodingAgentProfileId.Builtin,
    root,
    root,
  );
  repository.appendEvent(collaborator.id, CodingEventKind.Message, {
    role: 'user',
    content: 'collaborator note',
  });
  expect(service.listWorkspaces()[0].sessions).toHaveLength(2);

  const workspaces = service.deleteSession(root, collaborator.id);

  expect(workspaces[0].sessions.map(session => session.id)).toEqual([primaryLane.id]);
  expect(repository.listEvents([collaborator.id])).toHaveLength(0);
  expect(service.bootstrap(root).lanes.map(lane => lane.id)).toEqual([primaryLane.id]);
});

test('deleteSession of the primary session removes the whole mission', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-delete-'));
  tempDirectories.push(root);
  const repository = new CodingRoomRepository(db);
  const service = new CodingRoomService(repository, new CodingAgentRegistry(), {
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
  const snapshot = await service.createSession({
    workspaceId: workspace.id,
    sourceRoot: root,
    profileId: CodingAgentProfileId.Builtin,
    title: 'Main task',
  });
  const primaryLane = snapshot.lanes[0];
  repository.createLane(primaryLane.missionId, CodingAgentProfileId.Builtin, root, root);
  expect(service.listWorkspaces()[0].sessions).toHaveLength(2);

  const workspaces = service.deleteSession(root, primaryLane.id);

  expect(workspaces[0].sessions).toHaveLength(0);
  expect(service.bootstrap(root).missions).toHaveLength(0);
  expect(service.bootstrap(root).lanes).toHaveLength(0);
});

test('deleteSession refuses a running session', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-delete-'));
  tempDirectories.push(root);
  const repository = new CodingRoomRepository(db);
  const service = new CodingRoomService(repository, new CodingAgentRegistry(), {
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
  const snapshot = await service.createSession({
    workspaceId: workspace.id,
    sourceRoot: root,
    profileId: CodingAgentProfileId.Builtin,
    title: 'Main task',
  });
  const lane = snapshot.lanes[0];
  repository.updateLaneStatus(lane.id, CodingLaneStatus.Running);

  expect(() => service.deleteSession(root, lane.id)).toThrow(/Stop the running coding session/);
  expect(service.listWorkspaces()[0].sessions).toHaveLength(1);
});

test('applies draft config option overrides when starting a builtin session', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-overrides-'));
  tempDirectories.push(root);
  const startBuiltinSession = vi.fn(async () => undefined);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
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
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-overrides-'));
  tempDirectories.push(root);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
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
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-prepare-'));
  tempDirectories.push(root);
  const repository = new CodingRoomRepository(db);
  const service = new CodingRoomService(repository, new CodingAgentRegistry(), {
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
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
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

test('setLaneModelOverride persists the model and patches the live builtin session', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-model-'));
  tempDirectories.push(root);
  const patchBuiltinSession = vi.fn(async () => undefined);
  const service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    patchBuiltinSession,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });

  const [workspace] = service.createWorkspace({
    name: 'Product',
    sourceFolders: [root],
    defaultProfileId: CodingAgentProfileId.Builtin,
  });
  const snapshot = await service.createSession({
    workspaceId: workspace.id,
    sourceRoot: root,
    profileId: CodingAgentProfileId.Builtin,
    title: 'Main task',
  });
  const lane = snapshot.lanes[0];

  const next = await service.setLaneModelOverride(root, lane.id, 'openai/gpt-5');

  expect(next.lanes[0].modelOverride).toBe('openai/gpt-5');
  expect(patchBuiltinSession).toHaveBeenCalledWith(lane.localSessionId, {
    model: 'openai/gpt-5',
  });
  await expect(service.setLaneModelOverride(root, 'missing-lane', 'x')).rejects.toThrow(
    /not found/i,
  );
});

test('setLaneModelOverride rejects non-builtin lanes', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-model-'));
  tempDirectories.push(root);
  const registry = new CodingAgentRegistry();
  registry.registerExternal({
    name: 'External agent',
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
    command: execPath,
    args: ['-e', ''],
  });
  const repository = new CodingRoomRepository(db);
  const service = new CodingRoomService(repository, registry, {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });

  const profile = registry.list().find(candidate => !candidate.isBuiltin)!;
  const [workspace] = service.createWorkspace({
    name: 'Product',
    sourceFolders: [root],
    defaultProfileId: profile.id,
  });
  const snapshot = await service.createSession({
    workspaceId: workspace.id,
    sourceRoot: root,
    profileId: profile.id,
    title: 'External task',
  });

  await expect(
    service.setLaneModelOverride(root, snapshot.lanes[0].id, 'openai/gpt-5'),
  ).rejects.toThrow(/built-in/);
});

test('probeAgent revives a needs_auth profile when the agent responds', async () => {
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-reprobe-'));
  tempDirectories.push(root);
  const registry = new CodingAgentRegistry();
  registry.registerExternal({
    name: 'Recoverable ACP agent',
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
    command: execPath,
    args: [
      '-e',
      "process.stdin.on('data', chunk => { const line = String(chunk).split('\\n')[0]; const request = JSON.parse(line); if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n'); });",
    ],
  });
  const profile = registry.list().find(candidate => !candidate.isBuiltin)!;
  registry.markNeedsAuth(profile.id);

  const service = new CodingRoomService(new CodingRoomRepository(db), registry, {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const snapshot = await service.probeAgent(root, profile.id);

  expect(snapshot.profiles.find(candidate => candidate.id === profile.id)?.status).toBe(
    CodingAgentProfileStatus.Ready,
  );
  await service.dispose();
});
