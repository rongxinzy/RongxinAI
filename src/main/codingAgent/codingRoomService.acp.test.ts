import { execPath } from 'process';
import { expect, test, vi } from 'vitest';

import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  CodingEventKind,
  CodingLaneStatus,
} from '../../shared/codingAgent';
import { ACP_AUTH_REQUIRED_CODE, AcpSessionUpdateKind } from './acp/protocol';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { CodingRoomRepository } from './codingRoomRepository';
import { createService, openCodingRoomDatabase } from './codingRoomServiceTestHarness';

test.each([false, true])(
  'checks a detected ACP profile in its first user turn (auth required: %s)',
  async needsAuth => {
    const db = openCodingRoomDatabase();
    const registry = new CodingAgentRegistry();
    const builtin = registry.list().find(profile => profile.isBuiltin)!;
    const authMethod = { id: 'login', name: 'Log in' };
    const profile = registry.registerExternal({
      name: 'Test ACP',
      description: 'Test',
      driverKind: CodingAgentDriverKind.Acp,
      status: CodingAgentProfileStatus.Detected,
      capabilities: builtin.capabilities,
      authMethods: [],
      command: execPath,
      args: [
        '-e',
        `
      const lines = require('node:readline').createInterface({ input: process.stdin });
      const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
      lines.on('line', line => {
        const {id, method, params} = JSON.parse(line);
        if (method === 'initialize') send({ id, result: { protocolVersion: 1, authMethods: [${JSON.stringify(authMethod)}] } });
        if (method === 'session/new') send({ id, result: { sessionId: 'first-session' } });
        if (method !== 'session/prompt') return;
        if (params.prompt[0].text !== 'First user task') process.exit(1);
        if (${needsAuth}) {
          send({ id, error: { code: ${ACP_AUTH_REQUIRED_CODE}, message: 'Sign in' } });
          return;
        }
        send({ method: 'session/update', params: { sessionId: 'first-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done' } } } });
        send({ id, result: { stopReason: 'end_turn' } });
      });
    `,
      ],
    });
    const service = createService(new CodingRoomRepository(db), registry, {
      startBuiltinSession: async () => undefined,
      cancelBuiltinSession: async () => undefined,
      getBuiltinWorkbenchLink: () => null,
      beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
      completeExternalWorkbenchRun: () => undefined,
    });
    const sourceRoot = process.cwd();
    const [workspace] = await service.createWorkspace({
      name: 'Product',
      sourceFolders: [sourceRoot],
      defaultProfileId: builtin.id,
    });
    try {
      const started = await service.startSession({
        workspaceId: workspace.id,
        sourceRoot,
        profileId: profile.id,
        prompt: 'First user task',
      });
      await vi.waitFor(() => {
        const lane = service
          .bootstrap(sourceRoot)
          .lanes.find(item => item.id === started.lanes[0].id);
        expect(lane?.status).toBe(
          needsAuth ? CodingLaneStatus.NeedsAuth : CodingLaneStatus.Completed,
        );
      });
      expect(registry.get(profile.id)).toMatchObject({
        status: needsAuth ? CodingAgentProfileStatus.NeedsAuth : CodingAgentProfileStatus.Ready,
        authMethods: [authMethod],
      });
    } finally {
      await service.dispose();
    }
  },
);

test('requires explicit confirmation before sending a recovery summary to a replacement ACP session', async () => {
  const db = openCodingRoomDatabase();
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
  const service = createService(new CodingRoomRepository(db), registry, {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun,
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = process.cwd();
  const profile = registry.list().find(candidate => !candidate.isBuiltin)!;
  const created = await service.seedSession({ workspaceRoot, profileId: profile.id });
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
  const db = openCodingRoomDatabase();
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
  const service = createService(new CodingRoomRepository(db), registry, {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = process.cwd();
  const profile = registry.list().find(candidate => !candidate.isBuiltin)!;
  const created = await service.seedSession({ workspaceRoot, profileId: profile.id });

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

test('dispose waits for an in-flight turn to record its failure', async () => {
  const db = openCodingRoomDatabase();
  const registry = new CodingAgentRegistry();
  registry.registerExternal({
    name: 'Silent ACP agent',
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
      // Answers initialize and session/new but never session/prompt, so the
      // turn stays in flight until dispose() kills the child process.
      "let buffer=''; process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1); if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n'); if (request.method === 'session/new') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'silent-session' } }) + '\\n'); } });",
    ],
  });
  const service = createService(new CodingRoomRepository(db), registry, {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = process.cwd();
  const profile = registry.list().find(candidate => !candidate.isBuiltin)!;
  const created = await service.seedSession({ workspaceRoot, profileId: profile.id });
  const lane = created.lanes[0];

  await service.prompt(workspaceRoot, { laneId: lane.id, prompt: 'Keep working silently.' });
  // The turn is still parked on the silent agent here. dispose() must wait for
  // it to unwind and persist the outcome instead of returning early.
  await service.dispose();

  const snapshot = service.bootstrap(workspaceRoot);
  expect(snapshot.events.map(event => event.kind)).toContain(CodingEventKind.TurnFailed);
  expect(snapshot.lanes[0].status).toBe(CodingLaneStatus.Failed);
});

test('a turn settling after the test body does not touch a closed database', async () => {
  const db = openCodingRoomDatabase();
  const registry = new CodingAgentRegistry();
  registry.registerExternal({
    name: 'Slow ACP agent',
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
      // Answers session/prompt after 250ms with no session updates, so the turn
      // fails with AgentNoOutput well after this test body has returned. The
      // shared afterEach must dispose the service (awaiting the turn) before
      // closing the database, otherwise the failure handler hits a closed
      // connection and vitest reports an unhandled error.
      "let buffer=''; process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1); if (request.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {} } }) + '\\n'); if (request.method === 'session/new') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'slow-session' } }) + '\\n'); if (request.method === 'session/prompt') setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } }) + '\\n'), 250); } });",
    ],
  });
  const service = createService(new CodingRoomRepository(db), registry, {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  const workspaceRoot = process.cwd();
  const profile = registry.list().find(candidate => !candidate.isBuiltin)!;
  const created = await service.seedSession({ workspaceRoot, profileId: profile.id });

  await service.prompt(workspaceRoot, {
    laneId: created.lanes[0].id,
    prompt: 'Answer slowly.',
  });
  // Deliberately end the test while the turn is still in flight. Success is
  // the absence of an unhandled 'database connection is not open' error after
  // teardown.
});
