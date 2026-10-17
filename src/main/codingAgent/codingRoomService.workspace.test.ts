import { mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execPath } from 'process';
import { expect, test, vi } from 'vitest';

import {
  CodingAgentDriverKind,
  CodingAgentProfileId,
  CodingAgentProfileStatus,
  CodingEventKind,
  CodingLaneStatus,
} from '../../shared/codingAgent';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { CodingRoomRepository } from './codingRoomRepository';
import {
  createService,
  openCodingRoomDatabase,
  trackTempDirectory,
} from './codingRoomServiceTestHarness';

test('creates workspace-scoped sessions with immutable agent and source bindings', async () => {
  const db = openCodingRoomDatabase();
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-workspace-'));
  const primaryRoot = path.join(root, 'app');
  const sharedRoot = path.join(root, 'shared');
  mkdirSync(primaryRoot);
  mkdirSync(sharedRoot);
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
  const db = openCodingRoomDatabase();
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-unavailable-'));
  trackTempDirectory(root);
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
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
  const db = openCodingRoomDatabase();
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-acp-failure-'));
  trackTempDirectory(root);
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
  const service = createService(new CodingRoomRepository(db), registry, {
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

test('does not create a mission when the selected agent needs model configuration', async () => {
  const db = openCodingRoomDatabase();
  const service = createService(
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
  const db = openCodingRoomDatabase();
  const registry = new CodingAgentRegistry();
  const discoverExternalAgents = vi
    .spyOn(registry, 'discoverExternalAgents')
    .mockResolvedValue(undefined);
  const service = createService(new CodingRoomRepository(db), registry, {
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

test('deleteSession removes a collaborator lane but keeps the primary session', async () => {
  const db = openCodingRoomDatabase();
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-delete-'));
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
  const db = openCodingRoomDatabase();
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-delete-'));
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
  const db = openCodingRoomDatabase();
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-delete-'));
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

test('setLaneModelOverride persists the model and patches the live builtin session', async () => {
  const db = openCodingRoomDatabase();
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-model-'));
  trackTempDirectory(root);
  const patchBuiltinSession = vi.fn(async () => undefined);
  const service = createService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
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
  const db = openCodingRoomDatabase();
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-model-'));
  trackTempDirectory(root);
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
  const service = createService(repository, registry, {
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
  const db = openCodingRoomDatabase();
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-coding-reprobe-'));
  trackTempDirectory(root);
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
      "process.stdin.on('data', chunk => { for (const line of String(chunk).split('\\n').filter(Boolean)) { const request = JSON.parse(line); const reply = result => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n'); if (request.method === 'initialize') reply({ protocolVersion: 1, agentCapabilities: {} }); else if (request.method === 'session/new') reply({ sessionId: 'probe-session' }); else if (request.method === 'session/prompt') { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'probe-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } } } }) + '\\n'); reply({ stopReason: 'end_turn' }); } } });",
    ],
  });
  const profile = registry.list().find(candidate => !candidate.isBuiltin)!;
  registry.markNeedsAuth(profile.id);

  const service = createService(new CodingRoomRepository(db), registry, {
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

test('manages agent profiles without an open workspace', async () => {
  const db = openCodingRoomDatabase();
  const repository = new CodingRoomRepository(db);
  const service = createService(repository, new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });

  // The sidebar entry reaches the manager before any workspace is open, so
  // profile actions must work without one — and must not invent a room for an
  // empty root.
  expect(
    service.addProfile('', {
      name: 'Local Agent',
      description: '',
      command: execPath,
      args: [],
    }),
  ).toBeNull();
  expect(repository.listRooms()).toEqual([]);

  const profile = service.listProfiles().find(candidate => candidate.name === 'Local Agent');
  expect(profile).toBeDefined();

  expect(service.trustProfile('', profile!.id)).toBeNull();
  expect(service.listProfiles().find(candidate => candidate.id === profile!.id)?.status).toBe(
    CodingAgentProfileStatus.Detected,
  );
  await service.dispose();
});
