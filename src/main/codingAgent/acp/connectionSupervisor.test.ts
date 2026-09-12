import { mkdtemp, readFile, rm } from 'fs/promises';
import { expect, test, vi } from 'vitest';
import { execPath } from 'process';
import { tmpdir } from 'os';
import path from 'path';

import { AcpConnectionSupervisor, terminateProcessTree } from './connectionSupervisor';
import { AcpErrorCode, AcpMethod, AcpRequestError } from './protocol';

test('reports handler failures with the ACP error code the handler chose', async () => {
  const supervisor = new AcpConnectionSupervisor();
  supervisor.onRequest(async method => {
    if (method === 'fs/read_text_file') {
      throw new AcpRequestError(AcpErrorCode.ResourceNotFound, 'File not found.');
    }
    throw new Error('boom');
  });
  const script = [
    "let buffer=''; let initId=null; const answers=[];",
    "const send = message => process.stdout.write(JSON.stringify(message) + '\\n');",
    "process.stdin.on('data', chunk => { buffer += chunk; while (buffer.includes('\\n')) { const index = buffer.indexOf('\\n'); const message = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);",
    "if (message.method === 'initialize') { initId = message.id; send({ jsonrpc: '2.0', method: 'fs/read_text_file', id: 901, params: { sessionId: 's', path: '/missing' } }); send({ jsonrpc: '2.0', method: 'fs/write_text_file', id: 902, params: {} }); }",
    "if (message.id === 901 || message.id === 902) { answers.push({ id: message.id, code: message.error.code, message: message.error.message }); if (answers.length === 2) send({ jsonrpc: '2.0', id: initId, result: { answers } }); }",
    '} });',
  ].join('');
  await supervisor.start({
    executable: execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    environment: process.env as Record<string, string>,
  });
  const result = await supervisor.request<{
    answers: Array<{ id: number; code: number; message: string }>;
  }>(AcpMethod.Initialize, {});
  expect(result.answers.find(answer => answer.id === 901)).toEqual({
    id: 901,
    code: AcpErrorCode.ResourceNotFound,
    message: 'File not found.',
  });
  expect(result.answers.find(answer => answer.id === 902)).toEqual({
    id: 902,
    code: AcpErrorCode.InternalError,
    message: 'boom',
  });
  await supervisor.dispose();
});

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
  // Wait until the exit has actually been observed instead of assuming 200 ms is enough.
  await expect.poll(() => supervisor.isRunning(), { timeout: 5_000 }).toBe(false);
  const script =
    "process.stdin.on('data', chunk => { const request = JSON.parse(String(chunk)); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { restarted: true } }) + '\\n'); });";
  await supervisor.start({
    executable: execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    environment: process.env as Record<string, string>,
  });
  await expect(
    supervisor.request<{ restarted: boolean }>(AcpMethod.Initialize, {}),
  ).resolves.toEqual({
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

  await expect
    .poll(() => ({ generation: supervisor.generation, running: supervisor.isRunning() }), {
      timeout: 5_000,
    })
    .toEqual({ generation: 3, running: false });
  await supervisor.dispose();
});

test('allows a long-running prompt request to opt out of the short RPC timeout', async () => {
  const supervisor = new AcpConnectionSupervisor();
  const script =
    "process.stdin.on('data', chunk => { const request = JSON.parse(String(chunk)); setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { complete: true } }) + '\\n'), 40); });";
  await supervisor.start({
    executable: execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    environment: process.env as Record<string, string>,
  });

  await expect(
    supervisor.request<{ complete: boolean }>('session/prompt', {}, { timeoutMs: null }),
  ).resolves.toEqual({ complete: true });
  await supervisor.dispose();
});

test('holds request watchdogs while a tool approval waits for the user', async () => {
  const supervisor = new AcpConnectionSupervisor();
  await supervisor.start({
    executable: execPath,
    args: ['-e', 'process.stdin.resume();'],
    cwd: process.cwd(),
    environment: process.env as Record<string, string>,
  });
  vi.useFakeTimers();
  try {
    const prompt = supervisor.request('session/prompt', {}, { timeoutMs: 1_000 });
    const promptOutcome = prompt.then(
      () => 'resolved',
      (error: Error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(900);
    expect(await Promise.race([promptOutcome, Promise.resolve('pending')])).toBe('pending');

    // Approval wait: neither the running request nor one started during the
    // hold may spend its budget while the user is thinking.
    supervisor.holdRequestTimeouts();
    const control = supervisor.request('fs/read_text_file', {}, { timeoutMs: 500 });
    const controlOutcome = control.then(
      () => 'resolved',
      (error: Error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(await Promise.race([promptOutcome, Promise.resolve('pending')])).toBe('pending');
    expect(await Promise.race([controlOutcome, Promise.resolve('pending')])).toBe('pending');

    supervisor.releaseRequestTimeouts();
    await vi.advanceTimersByTimeAsync(101);
    await expect(promptOutcome).resolves.toBe('ACP request timed out: session/prompt.');
    expect(await Promise.race([controlOutcome, Promise.resolve('pending')])).toBe('pending');
    await vi.advanceTimersByTimeAsync(400);
    await expect(controlOutcome).resolves.toBe('ACP request timed out: fs/read_text_file.');
  } finally {
    vi.useRealTimers();
    await supervisor.dispose();
  }
});

test('renews the watchdog while the agent reports progress', async () => {
  const supervisor = new AcpConnectionSupervisor();
  await supervisor.start({
    executable: execPath,
    args: ['-e', 'process.stdin.resume();'],
    cwd: process.cwd(),
    environment: process.env as Record<string, string>,
  });
  vi.useFakeTimers();
  try {
    const prompt = supervisor.request('session/prompt', {}, { timeoutMs: 1_000 });
    const promptOutcome = prompt.then(
      () => 'resolved',
      (error: Error) => error.message,
    );
    for (let round = 0; round < 5; round += 1) {
      await vi.advanceTimersByTimeAsync(900);
      expect(await Promise.race([promptOutcome, Promise.resolve('pending')])).toBe('pending');
      supervisor.touchRequestTimeouts('session/prompt');
    }
    // Progress stopped: the renewals must not have disabled the watchdog.
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(promptOutcome).resolves.toBe('ACP request timed out: session/prompt.');
  } finally {
    vi.useRealTimers();
    await supervisor.dispose();
  }
});

test('renews the budget while held instead of arming the watchdog', async () => {
  const supervisor = new AcpConnectionSupervisor();
  await supervisor.start({
    executable: execPath,
    args: ['-e', 'process.stdin.resume();'],
    cwd: process.cwd(),
    environment: process.env as Record<string, string>,
  });
  vi.useFakeTimers();
  try {
    const prompt = supervisor.request('session/prompt', {}, { timeoutMs: 1_000 });
    const promptOutcome = prompt.then(
      () => 'resolved',
      (error: Error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(900);
    supervisor.holdRequestTimeouts();
    supervisor.touchRequestTimeouts('session/prompt');
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(await Promise.race([promptOutcome, Promise.resolve('pending')])).toBe('pending');

    // The hold preserved the renewed budget rather than the nearly spent one.
    supervisor.releaseRequestTimeouts();
    await vi.advanceTimersByTimeAsync(999);
    expect(await Promise.race([promptOutcome, Promise.resolve('pending')])).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await expect(promptOutcome).resolves.toBe('ACP request timed out: session/prompt.');
  } finally {
    vi.useRealTimers();
    await supervisor.dispose();
  }
});

test('enforces an absolute turn ceiling that progress cannot extend', async () => {
  const supervisor = new AcpConnectionSupervisor();
  await supervisor.start({
    executable: execPath,
    args: ['-e', 'process.stdin.resume();'],
    cwd: process.cwd(),
    environment: process.env as Record<string, string>,
  });
  vi.useFakeTimers();
  try {
    const prompt = supervisor.request(
      'session/prompt',
      {},
      { timeoutMs: 5_000, absoluteTimeoutMs: 3_000 },
    );
    const promptOutcome = prompt.then(
      () => 'resolved',
      (error: Error) => error.message,
    );
    for (let round = 0; round < 7; round += 1) {
      await vi.advanceTimersByTimeAsync(500);
      supervisor.touchRequestTimeouts('session/prompt');
    }
    await expect(promptOutcome).resolves.toBe(
      'ACP request timed out: session/prompt after the maximum turn duration.',
    );
  } finally {
    vi.useRealTimers();
    await supervisor.dispose();
  }
});

test('responds to agent requests that use a string JSON-RPC ID', async () => {
  const supervisor = new AcpConnectionSupervisor();
  supervisor.onRequest(async () => ({ accepted: true }));
  const script = [
    "process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'agent-request', method: 'fs/read_text_file', params: {} }) + '\\n');",
    "process.stdin.once('data', chunk => { const response = JSON.parse(String(chunk)); if (response.id !== 'agent-request') process.exit(1); process.exit(response.result?.accepted ? 0 : 1); });",
  ].join('');
  await supervisor.start({
    executable: execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    environment: process.env as Record<string, string>,
  });
  await expect.poll(() => supervisor.isRunning(), { timeout: 1_000 }).toBe(false);
  await supervisor.dispose();
});

test('falls back to terminating the child when Windows tree termination fails', async () => {
  const kill = vi.fn(() => true);
  await terminateProcessTree(
    { pid: 42, kill },
    {
      platform: 'win32',
      terminateWindowsTree: async pid => {
        expect(pid).toBe(42);
        throw new Error('taskkill failed');
      },
    },
  );
  expect(kill).toHaveBeenCalledWith('SIGTERM');
});

test('terminates descendants with the ACP process tree', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'acp-process-tree-'));
  const pidFile = path.join(root, 'child.pid');
  const script = [
    "const { spawn } = require('child_process');",
    "const fs = require('fs');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    'fs.writeFileSync(process.argv[1], String(child.pid));',
    'setInterval(() => {}, 1000);',
  ].join('');
  const supervisor = new AcpConnectionSupervisor();
  try {
    await supervisor.start({
      executable: execPath,
      args: ['-e', script, pidFile],
      cwd: process.cwd(),
      environment: process.env as Record<string, string>,
    });
    await expect
      .poll(
        async () => {
          try {
            return (await readFile(pidFile, 'utf8')).trim();
          } catch {
            return '';
          }
        },
        { timeout: 1_000 },
      )
      .not.toBe('');
    const pid = Number((await readFile(pidFile, 'utf8')).trim());
    expect(pid).toBeGreaterThan(0);

    await supervisor.dispose();
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 1_000 },
      )
      .toBe(false);
  } finally {
    await supervisor.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
