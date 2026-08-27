import { expect, test } from 'vitest';
import { execPath } from 'process';

import { AcpConnectionSupervisor } from './connectionSupervisor';
import { AcpMethod } from './protocol';

test('handles fragmented responses and session update notifications', async () => {
  const supervisor = new AcpConnectionSupervisor();
  const notifications: string[] = [];
  supervisor.onNotification(method => notifications.push(method));
  const script = [
    "let buffer='';",
    "process.stdin.on('data', chunk => { buffer += chunk; const newline = buffer.indexOf('\\n'); if (newline < 0) return; const request = JSON.parse(buffer.slice(0, newline));",
    'process.stdout.write(\'{\\"jsonrpc\\":\\"2.0\\",\\"method\\":\\"session/update\\",\\"params\\":{}}\\n\');',
    'process.stdout.write(\'{\\"jsonrpc\\":\\"2.0\\",\\"id\\":\' + request.id + \',\'); process.stdout.write(\'\\"result\\":{\\"ok\\":true}}\\n\'); });',
  ].join('');
  await supervisor.start({
    executable: execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    environment: process.env as Record<string, string>,
  });
  await expect(supervisor.request<{ ok: boolean }>(AcpMethod.Initialize, {})).resolves.toEqual({
    ok: true,
  });
  expect(notifications).toEqual(['session/update']);
  await supervisor.dispose();
});

test('allows a later start after the agent process exits', async () => {
  const supervisor = new AcpConnectionSupervisor();
  await supervisor.start({
    executable: execPath,
    args: ['-e', 'process.exit(0)'],
    cwd: process.cwd(),
    environment: process.env as Record<string, string>,
  });
  await new Promise(resolve => setTimeout(resolve, 200));
  const script =
    "process.stdin.on('data', chunk => { const request = JSON.parse(String(chunk)); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { restarted: true } }) + '\\n'); });";
  await supervisor.start({
    executable: execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    environment: process.env as Record<string, string>,
  });
  await expect(supervisor.request<{ restarted: boolean }>(AcpMethod.Initialize, {})).resolves.toEqual({
    restarted: true,
  });
  await supervisor.dispose();
});

test('isolates stderr and malformed stdout while matching out-of-order responses', async () => {
  const supervisor = new AcpConnectionSupervisor();
  const script = [
    "let buffer=''; const requests=[];",
    "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); requests.push(JSON.parse(buffer.slice(0, index))); buffer = buffer.slice(index + 1); if (requests.length === 2) { process.stderr.write('diagnostic only\\n'); process.stdout.write('not-json\\n'); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: requests[1].id, result: { order: 2 } }) + '\\n'); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: requests[0].id, result: { order: 1 } }) + '\\n'); } } });",
  ].join('');
  await supervisor.start({
    executable: execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    environment: process.env as Record<string, string>,
  });

  await expect(
    Promise.all([
      supervisor.request<{ order: number }>('first', {}),
      supervisor.request<{ order: number }>('second', {}),
    ]),
  ).resolves.toEqual([{ order: 1 }, { order: 2 }]);
  await supervisor.dispose();
});

test('limits background recovery to a finite number of restart attempts', async () => {
  const supervisor = new AcpConnectionSupervisor();
  await supervisor.start({
    executable: execPath,
    args: ['-e', 'process.exit(0)'],
    cwd: process.cwd(),
    environment: process.env as Record<string, string>,
  });

  await new Promise(resolve => setTimeout(resolve, 850));

  expect(supervisor.generation).toBe(3);
  expect(supervisor.isRunning()).toBe(false);
  await supervisor.dispose();
});
