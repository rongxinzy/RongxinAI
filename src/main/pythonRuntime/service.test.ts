import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { PythonExecutionResult, PythonRunnerRequest } from '../../shared/pythonRuntime';
import { PythonRuntimeService } from './service';

const mocked = vi.hoisted(() => ({ fork: vi.fn(), realpath: vi.fn() }));
vi.mock('node:child_process', () => ({ fork: mocked.fork }));
vi.mock('node:fs/promises', () => ({ realpath: mocked.realpath }));
vi.mock('./process', () => ({ runtimeNetworkEnvironment: () => ({}) }));

class Runner extends EventEmitter {
  stderr = new EventEmitter();
  connected = true;
  request?: PythonRunnerRequest;
  readonly send = vi.fn(
    (message: PythonRunnerRequest | { cancel: true }, callback?: (error: Error | null) => void) => {
      if (!('cancel' in message)) this.request = message;
      callback?.(null);
      return true;
    },
  );
  readonly kill = vi.fn(() => {
    this.exit(null, 'SIGTERM');
    return true;
  });

  complete(): void {
    const result: PythonExecutionResult = {
      stdout: 'completed',
      stderr: '',
      exitCode: 0,
      truncated: false,
      environmentId: `environment-${this.request?.input.workspace}`,
      runtimeId: 'fixture-runtime',
      pythonPath: '/managed/python',
    };
    this.emit('message', { success: true, result });
    this.exit(0);
  }

  fail(error: string): void {
    this.emit('message', { success: false, error });
    this.exit(1);
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (!this.connected) return;
    this.connected = false;
    this.emit('exit', code, signal);
  }
}

const runners: Runner[] = [];
const services: PythonRuntimeService[] = [];
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
const observe = <T>(promise: Promise<T>): Promise<Outcome<T>> =>
  promise.then(
    value => ({ ok: true, value }),
    error => ({ ok: false, error }),
  );

function createService(): PythonRuntimeService {
  const service = new PythonRuntimeService({ storageRoot: '/storage', runnerPath: '/runner.js' });
  services.push(service);
  return service;
}

beforeEach(() => {
  mocked.fork.mockReset().mockImplementation(() => {
    const child = new Runner();
    runners.push(child);
    return child;
  });
  mocked.realpath
    .mockReset()
    .mockImplementation(async (workspace: string) =>
      workspace === '/alias-a' ? '/workspace-a' : workspace,
    );
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(async () => {
  const stopped = services.splice(0).map(service => service.shutdown());
  for (const child of runners.splice(0)) child.exit(0);
  await Promise.all(stopped);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('runs two workspaces concurrently while serializing aliases across execute, install and prepare', async () => {
  const service = createService();
  const first = observe(service.execute({ workspace: '/workspace-a', code: 'first' }));
  const sameWorkspace = observe(
    service.install({ workspace: '/alias-a', packages: ['packaging'] }),
  );
  const second = observe(service.prepare({ workspace: '/workspace-b' }));
  const waiting = observe(service.execute({ workspace: '/workspace-c', code: 'waiting' }));
  await vi.waitFor(() => expect(runners).toHaveLength(2));
  expect(runners.map(child => child.request?.input.workspace)).toEqual([
    '/workspace-a',
    '/workspace-b',
  ]);

  runners[0].complete();
  await vi.waitFor(() => expect(runners).toHaveLength(3));
  expect(runners[2].request?.input).toMatchObject({
    workspace: '/workspace-a',
    packages: ['packaging'],
  });
  runners[1].complete();
  await vi.waitFor(() => expect(runners).toHaveLength(4));
  expect(runners[3].request?.input.workspace).toBe('/workspace-c');
  runners[2].complete();
  runners[3].complete();
  expect(await Promise.all([first, sameWorkspace, second, waiting])).toEqual([
    expect.objectContaining({ ok: true }),
    expect.objectContaining({ ok: true }),
    {
      ok: true,
      value: {
        pythonPath: '/managed/python',
        environmentId: 'environment-/workspace-b',
        runtimeId: 'fixture-runtime',
      },
    },
    expect.objectContaining({ ok: true }),
  ]);
});

test('cancels a queued operation immediately without waiting for its workspace or starting a Runner', async () => {
  const service = createService();
  const first = observe(service.execute({ workspace: '/workspace-a', code: 'active' }));
  const controller = new AbortController();
  const queued = observe(
    service.execute({ workspace: '/workspace-a', code: 'cancelled' }, controller.signal),
  );
  await vi.waitFor(() => expect(runners).toHaveLength(1));
  const reason = new Error('The user cancelled the queued task.');
  controller.abort(reason);
  expect(await queued).toEqual({ ok: false, error: reason });
  expect(mocked.fork).toHaveBeenCalledTimes(1);
  runners[0].complete();
  expect(await first).toMatchObject({ ok: true });
  await Promise.resolve();
  expect(mocked.fork).toHaveBeenCalledTimes(1);
});

test('bounds waiting operations and makes capacity available as soon as a queued request is cancelled', async () => {
  const service = createService();
  const active = [
    observe(service.execute({ workspace: '/active-a', code: 'active' })),
    observe(service.execute({ workspace: '/active-b', code: 'active' })),
  ];
  await vi.waitFor(() => expect(runners).toHaveLength(2));
  const controller = new AbortController();
  const waiting = Array.from({ length: 64 }, (_, index) =>
    observe(
      service.execute(
        { workspace: `/waiting-${index}`, code: 'waiting' },
        index === 0 ? controller.signal : undefined,
      ),
    ),
  );
  const overflow = await observe(service.execute({ workspace: '/overflow', code: 'overflow' }));
  expect(overflow).toMatchObject({
    ok: false,
    error: expect.objectContaining({ message: expect.stringContaining('queue is full') }),
  });
  const reason = new Error('Cancel one waiting request.');
  controller.abort(reason);
  expect(await waiting[0]).toEqual({ ok: false, error: reason });
  const replacement = observe(service.execute({ workspace: '/replacement', code: 'replacement' }));
  await Promise.resolve();
  expect(mocked.fork).toHaveBeenCalledTimes(2);
  const stopped = service.shutdown();
  for (const child of runners) child.exit(0);
  await stopped;
  const replacementOutcome = await replacement;
  expect(replacementOutcome).toMatchObject({
    ok: false,
    error: expect.objectContaining({ message: 'Python runtime is shutting down.' }),
  });
  await Promise.all([...active, ...waiting]);
});

test('shutdown rejects queued and future work while cancelling active Runners', async () => {
  const service = createService();
  const active = observe(service.execute({ workspace: '/workspace-a', code: 'active' }));
  const queued = observe(service.prepare({ workspace: '/workspace-a' }));
  await vi.waitFor(() => expect(runners).toHaveLength(1));
  const stopped = service.shutdown();
  expect(await queued).toMatchObject({
    ok: false,
    error: expect.objectContaining({ message: 'Python runtime is shutting down.' }),
  });
  expect(runners[0].send).toHaveBeenCalledWith({ cancel: true }, expect.any(Function));
  await expect(service.install({ workspace: '/future', packages: ['packaging'] })).rejects.toThrow(
    'shutting down',
  );
  expect(mocked.fork).toHaveBeenCalledTimes(1);
  runners[0].exit(0);
  await stopped;
  expect(await active).toMatchObject({ ok: false });
});

test('active cancellation keeps the slot occupied until the Runner exits, then starts waiting work', async () => {
  const service = createService();
  const controller = new AbortController();
  const first = observe(
    service.execute({ workspace: '/workspace-a', code: 'active' }, controller.signal),
  );
  const second = observe(service.execute({ workspace: '/workspace-b', code: 'active' }));
  const waiting = observe(service.execute({ workspace: '/workspace-c', code: 'waiting' }));
  await vi.waitFor(() => expect(runners).toHaveLength(2));
  controller.abort();
  expect(runners[0].send).toHaveBeenCalledWith({ cancel: true }, expect.any(Function));
  expect(mocked.fork).toHaveBeenCalledTimes(2);
  runners[0].exit(null, 'SIGTERM');
  expect(await first).toMatchObject({
    ok: false,
    error: expect.objectContaining({ message: 'Python operation cancelled.' }),
  });
  await vi.waitFor(() => expect(runners).toHaveLength(3));
  expect(runners[2].request?.input.workspace).toBe('/workspace-c');
  runners[1].complete();
  runners[2].complete();
  expect(await Promise.all([second, waiting])).toEqual([
    expect.objectContaining({ ok: true }),
    expect.objectContaining({ ok: true }),
  ]);
});

test('kills a Runner that ignores cancellation after the grace period', async () => {
  const service = createService();
  const controller = new AbortController();
  const running = observe(
    service.execute({ workspace: '/workspace-a', code: 'active' }, controller.signal),
  );
  await vi.waitFor(() => expect(runners).toHaveLength(1));
  vi.useFakeTimers();
  controller.abort();
  expect(runners[0].kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1500);
  expect(runners[0].kill).toHaveBeenCalledOnce();
  expect(await running).toMatchObject({
    ok: false,
    error: expect.objectContaining({ message: 'Python operation cancelled.' }),
  });
});

test('a failed Runner does not prevent the next operation in the same workspace', async () => {
  const service = createService();
  const failed = observe(
    service.install({ workspace: '/workspace-a', packages: ['missing-package'] }),
  );
  const next = observe(service.execute({ workspace: '/workspace-a', code: 'next' }));
  await vi.waitFor(() => expect(runners).toHaveLength(1));
  runners[0].fail('Package installation failed.');
  expect(await failed).toMatchObject({
    ok: false,
    error: expect.objectContaining({ message: 'Package installation failed.' }),
  });
  await vi.waitFor(() => expect(runners).toHaveLength(2));
  runners[1].complete();
  expect(await next).toMatchObject({ ok: true });
});

test('an already cancelled request never resolves a workspace or starts a Runner', async () => {
  const service = createService();
  const controller = new AbortController();
  controller.abort();
  await expect(
    service.execute({ workspace: '/workspace-a', code: 'cancelled' }, controller.signal),
  ).rejects.toThrow('aborted');
  expect(mocked.realpath).not.toHaveBeenCalled();
  expect(mocked.fork).not.toHaveBeenCalled();
});

test.each(['cancel', 'shutdown'] as const)(
  'does not launch after %s while workspace resolution is pending',
  async action => {
    const service = createService();
    const controller = new AbortController();
    let resolveWorkspace: (value: string) => void = () => {};
    mocked.realpath.mockImplementationOnce(
      () =>
        new Promise<string>(resolve => {
          resolveWorkspace = resolve;
        }),
    );
    const pending = observe(
      service.execute({ workspace: '/workspace-a', code: 'pending' }, controller.signal),
    );
    if (action === 'cancel') controller.abort();
    else await service.shutdown();
    resolveWorkspace('/workspace-a');
    expect(await pending).toMatchObject({ ok: false });
    expect(mocked.fork).not.toHaveBeenCalled();
  },
);
