import { execPath } from 'process';
import { expect, test } from 'vitest';

import { AcpProtocolIncompatibleError } from './protocol';
import { AcpProbeNoAnswerError, AcpProbeService } from './probeService';

/**
 * A fake ACP agent that answers `initialize`, `session/new` and `session/prompt`
 * the way a configured agent does. `answerPrompt` decides whether the prompt
 * turn produces an assistant chunk — the connection check requires one.
 */
const fakeAgentScript = (options: {
  protocolVersion?: number;
  authMethods?: string;
  answerPrompt: boolean;
}): string => `
process.stdin.on('data', chunk => {
  for (const line of String(chunk).split('\\n')) {
    if (!line.trim()) continue;
    let request;
    try { request = JSON.parse(line); } catch { continue; }
    const reply = (result) =>
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
    if (request.method === 'initialize') {
      reply({
        protocolVersion: ${options.protocolVersion ?? 1},
        agentCapabilities: {},
        authMethods: ${options.authMethods ?? '[]'},
      });
    } else if (request.method === 'session/new') {
      reply({ sessionId: 'probe-session' });
    } else if (request.method === 'session/prompt') {
      ${
        options.answerPrompt
          ? `process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: request.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } } } }) + '\\n');`
          : ''
      }
      reply({ stopReason: 'end_turn' });
    } else {
      reply({});
    }
  }
});
`;

const probe = (script: string) =>
  new AcpProbeService().probe({
    executable: execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    environment: process.env as Record<string, string>,
  });

test('rejects a probe when the agent negotiates an older protocol version', async () => {
  const script =
    "process.stdin.on('data', chunk => { const request = JSON.parse(String(chunk)); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 0, agentCapabilities: {} } }) + '\\n'); });";

  await expect(
    probe(fakeAgentScript({ protocolVersion: 2, answerPrompt: true })),
  ).rejects.toBeInstanceOf(AcpProtocolIncompatibleError);
});

test('accepts a probe when the agent answers with a newer protocol version', async () => {
  const script =
    "process.stdin.on('data', chunk => { const request = JSON.parse(String(chunk)); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 2, agentCapabilities: { loadSession: true } } }) + '\\n'); });";

  await expect(
    new AcpProbeService().probe({
      executable: execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      environment: process.env as Record<string, string>,
    }),
  ).resolves.toMatchObject({
    capabilities: expect.objectContaining({ supportsLoadSession: true }),
  });
});

test('advertises terminal authentication support while probing available auth methods', async () => {
  await expect(
    probe(
      fakeAgentScript({
        authMethods: "[{ id: 'login', name: 'Sign in', type: 'terminal', args: ['login'] }]",
        answerPrompt: true,
      }),
    ),
  ).resolves.toMatchObject({
    authMethods: [expect.objectContaining({ id: 'login', type: 'terminal' })],
  });
});

// The connection check waits 45s for the first answer before it gives a verdict.
test('rejects a probe when the agent accepts the connection but answers nothing', { timeout: 90_000 }, async () => {
  // The shape a rejected API key or an unreachable model endpoint takes: the
  // handshake succeeds, the prompt turn ends with no assistant chunk.
  await expect(
    probe(
      fakeAgentScript({
        authMethods: "[{ id: 'login', name: 'Sign in', type: 'terminal' }]",
        answerPrompt: false,
      }),
    ),
  ).rejects.toBeInstanceOf(AcpProbeNoAnswerError);
});
