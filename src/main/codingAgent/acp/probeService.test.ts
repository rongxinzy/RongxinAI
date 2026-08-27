import { execPath } from 'process';
import { expect, test } from 'vitest';

import { AcpProtocolIncompatibleError } from './protocol';
import { AcpProbeService } from './probeService';

test('rejects a probe when the agent does not negotiate ACP v1', async () => {
  const script =
    "process.stdin.on('data', chunk => { const request = JSON.parse(String(chunk)); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 2, agentCapabilities: {} } }) + '\\n'); });";

  await expect(
    new AcpProbeService().probe({
      executable: execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      environment: process.env as Record<string, string>,
    }),
  ).rejects.toBeInstanceOf(AcpProtocolIncompatibleError);
});

test('advertises terminal authentication support while probing available auth methods', async () => {
  const script =
    "process.stdin.on('data', chunk => { const request = JSON.parse(String(chunk)); const terminal = request.params?.clientCapabilities?.auth?.terminal === true; process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: terminal ? [{ id: 'login', name: 'Sign in', type: 'terminal', args: ['login'] }] : [] } }) + '\\n'); });";

  await expect(
    new AcpProbeService().probe({
      executable: execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      environment: process.env as Record<string, string>,
    }),
  ).resolves.toMatchObject({
    authMethods: [expect.objectContaining({ id: 'login', type: 'terminal' })],
  });
});
