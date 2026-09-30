import Database from 'better-sqlite3';
import { execPath } from 'process';
import { afterEach, expect, test, vi } from 'vitest';

import { CodingAgentEnvironmentKey, CodingAgentProfileStatus } from '../../shared/codingAgent';
import { AcpMethod, AcpSessionUpdateKind } from './acp/protocol';
import { AuthTerminalService } from './authTerminalService';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { CodingRoomRepository } from './codingRoomRepository';
import { CodingRoomService } from './codingRoomService';
import { initializeCodingAgentSchema } from './schema';

let db: Database.Database | undefined;
let service: CodingRoomService | undefined;

afterEach(async () => {
  await service?.dispose();
  service = undefined;
  db?.close();
  db = undefined;
  vi.restoreAllMocks();
});

test.each([
  { answers: true, terminal: false },
  { answers: false, terminal: false },
  { answers: true, terminal: true },
  { answers: false, terminal: true },
])(
  'authentication requires a real model answer ($answers, terminal=$terminal)',
  async ({ answers, terminal }) => {
    db = new Database(':memory:');
    initializeCodingAgentSchema(db);
    const registry = new CodingAgentRegistry();
    const method = {
      id: 'configured-login',
      name: 'Configured login',
      ...(terminal ? { type: 'terminal', args: ['login'] } : {}),
    };
    const script = String.raw`
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk;
  while (buffer.includes('\n')) {
    const newline = buffer.indexOf('\n');
    const request = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    const send = data => process.stdout.write(JSON.stringify(data) + '\n');
    const reply = result => send({jsonrpc:'2.0', id:request.id, result});
    if (request.method === ${JSON.stringify(AcpMethod.Initialize)}) {
      reply({protocolVersion:1, agentCapabilities:{}, authMethods:[${JSON.stringify(method)}]});
    } else if (request.method === ${JSON.stringify(AcpMethod.SessionNew)}) {
      reply({sessionId:'verified-session'});
    } else if (request.method === ${JSON.stringify(AcpMethod.SessionPrompt)}) {
      if (${answers}) send({jsonrpc:'2.0', method:${JSON.stringify(AcpMethod.SessionUpdate)},
        params:{sessionId:'verified-session',update:{sessionUpdate:${JSON.stringify(AcpSessionUpdateKind.AgentMessageChunk)},content:{type:'text',text:'ok'}}}});
      reply({stopReason:'end_turn'});
    } else if (request.id !== undefined) reply({});
  }
});`;
    const profile = registry.addUntrustedProfile({
      name: 'Authentication test agent',
      description: '',
      command: execPath,
      args: ['-e', script],
    });
    profile.authMethods.push(method);
    profile.environment[CodingAgentEnvironmentKey.ElectronRunAsNode] = '1';
    registry.trust(profile.id);
    registry.markNeedsAuth(profile.id);
    service = new CodingRoomService(new CodingRoomRepository(db), registry, {
      startBuiltinSession: async () => undefined,
      cancelBuiltinSession: async () => undefined,
      getBuiltinWorkbenchLink: () => null,
      beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
      completeExternalWorkbenchRun: () => undefined,
    });

    if (terminal) {
      vi.spyOn(AuthTerminalService.prototype, 'start').mockImplementation(
        function (this: AuthTerminalService, input) {
          const event = {
            id: 'test-terminal',
            profileId: input.profileId,
            methodId: input.methodId,
            workspaceRoot: input.cwd,
          };
          queueMicrotask(() => this.emit('exit', { ...event, exitCode: 0 }));
          return event;
        },
      );
      const completed = new Promise<void>(resolve =>
        service!.once('authTerminalExit', () => resolve()),
      );
      service.startTerminalAuthentication(process.cwd(), profile.id, method.id);
      await completed;
      expect(registry.get(profile.id)?.status).toBe(
        answers ? CodingAgentProfileStatus.Ready : CodingAgentProfileStatus.Unavailable,
      );
      return;
    }
    const authenticating = service.authenticateProfile(process.cwd(), profile.id, method.id);
    if (answers) {
      await authenticating;
      expect(registry.get(profile.id)?.status).toBe(CodingAgentProfileStatus.Ready);
    } else {
      await expect(authenticating).rejects.toThrow();
      expect(registry.get(profile.id)?.status).toBe(CodingAgentProfileStatus.Unavailable);
    }
  },
);
