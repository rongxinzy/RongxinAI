import { execPath } from 'process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { expect, test } from 'vitest';

import {
  CodingAgentCheckFailure,
  CodingAgentCheckPhase,
  CodingAgentProfileStatus,
  CodingErrorMessage,
} from '../../../shared/codingAgent';
import { CodingAgentRegistry } from '../codingAgentRegistry';
import {
  ACP_AUTH_REQUIRED_CODE,
  AcpMethod,
  AcpProtocolIncompatibleError,
  AcpSessionUpdateKind,
} from './protocol';
import { AcpProbeFailureError, AcpProbeNoAnswerError, AcpProbeService } from './probeService';

const AUTH_METHODS = [{ id: 'login', name: 'Sign in', type: 'terminal', args: ['login'] }];

/** Real stdio process: cancellation is notification-only, never acknowledged. */
const fakeAgentScript = (
  options: {
    protocolVersion?: number;
    answerPrompt?: boolean;
    errorMethod?: string;
    errorCode?: number;
    errorMessage?: string;
    silent?: boolean;
    thoughtOnly?: boolean;
  } = {},
): string => String.raw`
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk;
  while (buffer.includes('\n')) {
    const newline = buffer.indexOf('\n');
    const request = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    const reply = result => process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:request.id, result })+'\n');
    if (request.method === ${JSON.stringify(AcpMethod.SessionCancel)}) {
      if (request.id !== undefined) process.exit(2);
      continue;
    }
    if (request.method === ${JSON.stringify(options.errorMethod ?? '')}) {
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:${options.errorCode ?? ACP_AUTH_REQUIRED_CODE},message:${JSON.stringify(options.errorMessage ?? 'Authentication required')}}})+'\n');
    } else if (request.method === ${JSON.stringify(AcpMethod.Initialize)}) {
      reply({protocolVersion:${options.protocolVersion ?? 1},agentCapabilities:{},authMethods:${JSON.stringify(AUTH_METHODS)}});
    } else if (request.method === ${JSON.stringify(AcpMethod.SessionNew)}) {
      reply({sessionId:'probe-session'});
    } else if (request.method === ${JSON.stringify(AcpMethod.SessionPrompt)}) {
      if (${options.answerPrompt !== false || options.thoughtOnly === true}) {
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:${JSON.stringify(AcpMethod.SessionUpdate)},params:{sessionId:'probe-session',update:{sessionUpdate:${JSON.stringify(options.thoughtOnly ? AcpSessionUpdateKind.AgentThoughtChunk : AcpSessionUpdateKind.AgentMessageChunk)},content:{type:'text',text:'ok'}}}})+'\n');
      }
      if (!${options.silent === true}) reply({stopReason:'end_turn'});
    } else reply({});
  }
});`;

const probe = (script: string) =>
  new AcpProbeService().probe({
    executable: execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    environment: process.env,
  });

test('rejects an incompatible protocol version', async () => {
  await expect(probe(fakeAgentScript({ protocolVersion: 0 }))).rejects.toBeInstanceOf(
    AcpProtocolIncompatibleError,
  );
});

test('accepts a newer protocol version after receiving an assistant answer', async () => {
  await expect(probe(fakeAgentScript({ protocolVersion: 2 }))).resolves.toMatchObject({ authMethods: AUTH_METHODS });
});

test('a successful notification-only agent finishes without waiting for a cancel response', async () => {
  const startedAt = Date.now();
  await expect(probe(fakeAgentScript())).resolves.toMatchObject({ authMethods: AUTH_METHODS });
  expect(Date.now() - startedAt).toBeLessThan(5_000);
});

test('an empty completed prompt fails immediately instead of waiting 45 seconds', async () => {
  const startedAt = Date.now();
  await expect(probe(fakeAgentScript({ answerPrompt: false }))).rejects.toBeInstanceOf(
    AcpProbeNoAnswerError,
  );
  expect(Date.now() - startedAt).toBeLessThan(5_000);
});

test('thought output alone cannot certify a working model', async () => {
  await expect(
    probe(fakeAgentScript({ answerPrompt: false, thoughtOnly: true })),
  ).rejects.toBeInstanceOf(AcpProbeNoAnswerError);
});

test('an empty response with login methods stays unavailable rather than requiring login', async () => {
  const registry = new CodingAgentRegistry();
  const profile = registry.addUntrustedProfile({
    name: 'Configured agent',
    description: '',
    command: execPath,
    args: ['-e', fakeAgentScript({ answerPrompt: false })],
  });
  registry.trust(profile.id);
  await expect(registry.probe(profile.id, process.cwd())).rejects.toMatchObject({
    needsAuth: false,
  });
  expect(registry.get(profile.id)).toMatchObject({
    status: CodingAgentProfileStatus.Unavailable,
    authMethods: AUTH_METHODS,
    connectionCheck: { failure: CodingAgentCheckFailure.NoReply },
  });
});

test.each([AcpMethod.SessionNew, AcpMethod.SessionPrompt])(
  'preserves login methods for an auth error from %s',
  async errorMethod => {
    const registry = new CodingAgentRegistry();
    const untrusted = registry.addUntrustedProfile({
      name: 'test',
      description: '',
      command: execPath,
      args: ['-e', fakeAgentScript({ errorMethod, errorMessage: 'Sign-in needed' })],
    });
    registry.trust(untrusted.id);
    await expect(registry.probe(untrusted.id, process.cwd())).rejects.toThrow(
      CodingErrorMessage.AgentAuthRequired,
    );
    expect(registry.get(untrusted.id)).toMatchObject({
      status: CodingAgentProfileStatus.NeedsAuth,
      authMethods: AUTH_METHODS,
      connectionCheck: {
        phase: CodingAgentCheckPhase.Failed,
        failure: CodingAgentCheckFailure.Authentication,
      },
    });
  },
);

test('ready agents can be rechecked with real phase updates and duplicate checks are rejected', async () => {
  const registry = new CodingAgentRegistry();
  const added = registry.addUntrustedProfile({
    name: 'test',
    description: '',
    command: execPath,
    args: ['-e', fakeAgentScript()],
  });
  registry.trust(added.id);
  await registry.probe(added.id, process.cwd());
  const phases: Array<CodingAgentCheckPhase | undefined> = [];
  registry.on('changed', () => phases.push(registry.get(added.id)?.connectionCheck?.phase));
  const checking = registry.probe(added.id, process.cwd());
  await expect(registry.probe(added.id, process.cwd())).rejects.toThrow(
    CodingErrorMessage.ProfileNotProbeable,
  );
  await checking;
  expect(phases).toEqual([
    CodingAgentCheckPhase.Starting,
    CodingAgentCheckPhase.Handshake,
    CodingAgentCheckPhase.ModelReply,
    CodingAgentCheckPhase.Complete,
  ]);
  expect(registry.get(added.id)?.connectionCheck?.checkedAt).toBeGreaterThan(0);
});

test.runIf(process.platform === 'win32')(
  'manually added batch agents support paths and arguments with spaces after trust',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'manual ACP agent '));
    const launcher = path.join(root, 'custom agent.cmd');
    const argsFile = path.join(root, 'arguments.json');
    try {
      await writeFile(
        path.join(root, 'agent.cjs'),
        `require('fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\n${fakeAgentScript()}`,
      );
      await writeFile(launcher, `@echo off\r\n"${execPath}" "%~dp0agent.cjs" %*\r\n`);
      const registry = new CodingAgentRegistry();
      const profile = registry.addUntrustedProfile({
        name: ' Manual Agent ',
        description: 'User supplied ACP command',
        command: ` ${launcher} `,
        args: ['argument with spaces', 'literal & echo injected', 'a|b', 'quote "value"', '%PATH%'],
      });
      expect(profile.name).toBe('Manual Agent');
      expect(profile.command).toBe(launcher);
      await expect(registry.probe(profile.id, root)).rejects.toThrow(
        CodingErrorMessage.ProfileNotProbeable,
      );
      registry.trust(profile.id);
      await expect(registry.probe(profile.id, root)).resolves.toMatchObject({
        status: CodingAgentProfileStatus.Ready,
        connectionCheck: { phase: CodingAgentCheckPhase.Complete },
      });
      expect(JSON.parse(await readFile(argsFile, 'utf8'))).toEqual(profile.args);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test('a model failure retains its cause without misclassifying it as auth', async () => {
  await expect(
    probe(
      fakeAgentScript({
        errorMethod: AcpMethod.SessionPrompt,
        errorCode: -32603,
        errorMessage: 'model unavailable',
      }),
    ),
  ).rejects.toMatchObject({
    message: expect.stringContaining('model unavailable'),
    authMethods: AUTH_METHODS,
    needsAuth: false,
  });
});

test(
  'a completely silent prompt is bounded by the first-answer timeout',
  { timeout: 55_000 },
  async () => {
    await expect(
      probe(fakeAgentScript({ answerPrompt: false, silent: true })),
    ).rejects.toBeInstanceOf(AcpProbeFailureError);
  },
);
