import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { StrataServiceStatus } from '../../../shared/strata/types';
import { StrataManager } from './strataManager';

const strataClientMock = vi.hoisted(() => ({
  health: vi.fn(async () => false),
  listModels: vi.fn(async () => []),
}));

const childProcessMock = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('./strataClient', () => ({
  StrataClient: class {
    health = strataClientMock.health;
    listModels = strataClientMock.listModels;
  },
}));

vi.mock('child_process', () => ({
  spawn: childProcessMock.spawn,
  default: {},
}));

vi.mock('./strataProcess', () => ({
  resolveStrataProcessCommand: (executable: string, args: string[]) => ({ executable, args }),
  watchStrataReady: (
    _stdout: unknown,
    _port: number,
    ready: (id: string) => void,
    serving: () => void,
  ) => {
    serving();
    ready('model');
  },
}));

vi.mock('./strataEditionPolicy', () => ({
  isStrataFeatureEnabled: () => true,
}));

vi.mock('./strataBundledManifest', () => ({
  readStrataBundledManifest: () => ({
    schemaVersion: 1,
    releaseTag: 'test',
    defaultPort: 8096,
    runtimeRoot: 'runtime',
    componentsRoot: 'components',
    pythonExecutable: 'python.exe',
    engineQwenFolder: 'qwen',
    engineDsv41Folder: 'dsv41',
    sha256: { python: '', strata: '', strataDsv41: '' },
    attribution: '',
  }),
  resolveStrataBundledRoot: () => 'C:\\fake-strata',
  resolveStrataDefaultPort: () => 8096,
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, default: { ...actual, existsSync: () => true } };
});

const CATALOG_ID = 'strata-qwen-flash-next';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  pid = 4321;
  killSignals: NodeJS.Signals[] = [];
  exitOnSigkill = true;
  kill = vi.fn((signal: NodeJS.Signals) => {
    this.killSignals.push(signal);
    if (signal === 'SIGKILL' && this.exitOnSigkill) this.exit(137, 'SIGKILL');
    return true;
  });

  exit(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

let child: FakeChild;

const createManager = (): StrataManager => new StrataManager(() => ({ port: '8096' }));

const start = (manager: StrataManager) => manager.start({ catalogId: CATALOG_ID });

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  strataClientMock.health.mockResolvedValue(false);
  strataClientMock.listModels.mockResolvedValue([{ id: 'model' }]);
  child = new FakeChild();
  childProcessMock.spawn.mockReturnValue(child);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('StrataManager lifecycle', () => {
  test('keeps ownership when the process ignores termination and permits a stop retry', async () => {
    const manager = createManager();
    child.exitOnSigkill = false;
    const starting = start(manager);
    await flush();
    const stopping = manager.stop();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await stopping).toMatchObject({
      status: StrataServiceStatus.Error,
      managedByApp: true,
    });
    await starting;
    expect(await manager.detect()).toMatchObject({
      status: StrataServiceStatus.Error,
      managedByApp: true,
    });
    child.exitOnSigkill = true;
    const retry = manager.stop();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await retry).toMatchObject({ status: StrataServiceStatus.Stopped, managedByApp: false });
  });

  test('does not emit status events while the running snapshot is unchanged', async () => {
    strataClientMock.health.mockResolvedValue(true);
    const manager = createManager();
    const events: string[] = [];
    manager.on('status', snapshot => events.push(snapshot.status));

    await manager.detect();
    await manager.detect();
    await manager.detect();

    expect(events).toEqual([StrataServiceStatus.Running]);
    expect(strataClientMock.health).toHaveBeenCalledTimes(3);
  });

  test('startup timeout kills the managed child and settles on error, not starting', async () => {
    const manager = createManager();
    const events: string[] = [];
    manager.on('status', snapshot => events.push(snapshot.status));
    const startPromise = start(manager);
    await flush();
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(130_000);
    const status = await startPromise;

    expect(status.status).toBe(StrataServiceStatus.Error);
    expect(status.error).toContain('timeout');
    expect(status.managedByApp).toBe(false);
    expect(events).toEqual([StrataServiceStatus.Starting, StrataServiceStatus.Error]);
    expect(child.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(manager.getStatus().managedByApp).toBe(false);

    const afterTimeout = await manager.detect();
    expect(afterTimeout.status).toBe(StrataServiceStatus.Stopped);
  });

  test('child exit during startup ends the wait and reports the failure', async () => {
    const manager = createManager();
    const startPromise = start(manager);
    await flush();

    child.exit(1, null);
    await vi.advanceTimersByTimeAsync(1_000);
    const status = await startPromise;

    expect(status.status).toBe(StrataServiceStatus.Error);
    expect(status.error).toContain('exited before it became ready');
    expect(manager.getStatus().managedByApp).toBe(false);
  });

  test('spawn errors end the wait and clear the managed process reference', async () => {
    const manager = createManager();
    const startPromise = start(manager);
    await flush();

    child.emit('error', new Error('spawn failed'));
    await vi.advanceTimersByTimeAsync(1_000);
    const status = await startPromise;

    expect(status.status).toBe(StrataServiceStatus.Error);
    expect(status.error).toBe('spawn failed');
    expect(manager.getStatus().managedByApp).toBe(false);
  });

  test('synchronous spawn failure reports an error status', async () => {
    childProcessMock.spawn.mockImplementationOnce(() => {
      throw new Error('cannot spawn');
    });
    const manager = createManager();

    const status = await start(manager);

    expect(status.status).toBe(StrataServiceStatus.Error);
    expect(status.error).toBe('cannot spawn');
    expect(status.managedByApp).toBe(false);
  });

  test('stop during startup cancels the pending wait and leaves a stopped state', async () => {
    const manager = createManager();
    const startPromise = start(manager);
    await flush();

    const stopPromise = manager.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    const [started, stopped] = await Promise.all([startPromise, stopPromise]);

    expect(stopped.status).toBe(StrataServiceStatus.Stopped);
    expect(started.status).toBe(StrataServiceStatus.Stopped);
    expect(manager.getStatus().status).toBe(StrataServiceStatus.Stopped);
    expect(child.killSignals[0]).toBe('SIGTERM');
  });

  test('duplicate start calls share one managed process', async () => {
    strataClientMock.health.mockResolvedValue(true);
    const manager = createManager();

    const [first, second] = await Promise.all([start(manager), start(manager)]);
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(StrataServiceStatus.Running);
    expect(second.status).toBe(StrataServiceStatus.Running);

    const again = await start(manager);
    expect(again.status).toBe(StrataServiceStatus.Running);
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
    expect(manager.getStatus().activeModelId).toBe(CATALOG_ID);
  });

  test('a different catalog supersedes the in-flight startup', async () => {
    const firstChild = new FakeChild();
    const secondChild = new FakeChild();
    childProcessMock.spawn.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
    const manager = createManager();

    strataClientMock.health.mockResolvedValue(false);
    const firstStart = start(manager);
    await flush();
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);

    const secondStart = manager.start({ catalogId: 'strata-deepseek-v41-flash' });
    await vi.advanceTimersByTimeAsync(0);
    strataClientMock.health.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(20_000);

    const [firstStatus, secondStatus] = await Promise.all([firstStart, secondStart]);
    expect(firstChild.killSignals).toContain('SIGTERM');
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(2);
    expect(childProcessMock.spawn.mock.calls[1][1]).toContain('IST-DAS-2.00bpw');
    expect(firstStatus.status).toBe(StrataServiceStatus.Stopped);
    expect(secondStatus.status).toBe(StrataServiceStatus.Running);
    expect(manager.getStatus().activeModelId).toBe('strata-deepseek-v41-flash');
  });

  test('reusing a running process preserves its exit listener', async () => {
    strataClientMock.health.mockResolvedValue(true);
    const manager = createManager();
    await start(manager);
    await start(manager);

    child.exit(0, null);

    expect(manager.getStatus().status).toBe(StrataServiceStatus.Stopped);
    expect(manager.getStatus().managedByApp).toBe(false);
    strataClientMock.health.mockResolvedValue(false);
    expect((await manager.detect()).status).toBe(StrataServiceStatus.Stopped);
  });

  test('the latest A request wins during an A to B to A switch', async () => {
    const firstChild = new FakeChild();
    const lastChild = new FakeChild();
    childProcessMock.spawn.mockReturnValueOnce(firstChild).mockReturnValueOnce(lastChild);
    const manager = createManager();
    const firstStart = start(manager);
    await flush();

    const middleStart = manager.start({ catalogId: 'strata-deepseek-v41-flash' });
    await flush();
    const lastStart = start(manager);
    strataClientMock.health.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(20_000);
    const [first, middle, last] = await Promise.all([firstStart, middleStart, lastStart]);

    expect(first.status).toBe(StrataServiceStatus.Stopped);
    expect(middle.status).toBe(StrataServiceStatus.Stopped);
    expect(last.status).toBe(StrataServiceStatus.Running);
    expect(last.activeModelId).toBe(CATALOG_ID);
    expect(manager.getStatus().activeModelId).toBe(CATALOG_ID);
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(2);
    expect(childProcessMock.spawn.mock.calls[1][1]).toContain('Gyro-S');
  });

  test('reusing a running process preserves its error listener', async () => {
    strataClientMock.health.mockResolvedValue(true);
    const manager = createManager();
    await start(manager);
    await start(manager);

    child.emit('error', new Error('reused child failed'));

    expect(manager.getStatus().status).toBe(StrataServiceStatus.Error);
    expect(manager.getStatus().error).toBe('reused child failed');
    expect(manager.getStatus().managedByApp).toBe(false);
  });

  test.each(['exit', 'error'] as const)(
    'a pending detect cannot overwrite the current child %s',
    async event => {
      strataClientMock.health.mockResolvedValue(true);
      const manager = createManager();
      await start(manager);
      let resolveHealth: (healthy: boolean) => void = () => {};
      strataClientMock.health.mockImplementationOnce(
        () =>
          new Promise<boolean>(resolve => {
            resolveHealth = resolve;
          }),
      );
      const detection = manager.detect();
      if (event === 'exit') child.exit(0, null);
      else child.emit('error', new Error('child failed during detect'));
      const terminal = manager.getStatus();
      resolveHealth(true);
      await detection;

      expect(manager.getStatus()).toEqual(terminal);
      expect(terminal.managedByApp).toBe(false);
    },
  );

  test('stop cancels the latest request while switch cleanup is still running', async () => {
    const manager = createManager();
    const firstStart = start(manager);
    await flush();
    const nextStart = manager.start({ catalogId: 'strata-deepseek-v41-flash' });
    await flush();

    const stopPromise = manager.stop();
    strataClientMock.health.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(20_000);
    const results = await Promise.all([firstStart, nextStart, stopPromise]);

    expect(results.map(result => result.status)).toEqual([
      StrataServiceStatus.Stopped,
      StrataServiceStatus.Stopped,
      StrataServiceStatus.Stopped,
    ]);
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
    expect(manager.getStatus().status).toBe(StrataServiceStatus.Stopped);
    expect(manager.getStatus().managedByApp).toBe(false);
  });

  test('duplicate queued requests share the replacement process', async () => {
    const secondChild = new FakeChild();
    childProcessMock.spawn.mockReturnValueOnce(child).mockReturnValueOnce(secondChild);
    const manager = createManager();
    const firstStart = start(manager);
    await flush();
    const input = { catalogId: 'strata-deepseek-v41-flash' };
    const secondStart = manager.start(input);
    const duplicate = manager.start(input);
    strataClientMock.health.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(20_000);
    const [first, second, repeated] = await Promise.all([firstStart, secondStart, duplicate]);

    expect(first.status).toBe(StrataServiceStatus.Stopped);
    expect(second.status).toBe(StrataServiceStatus.Running);
    expect(repeated.activeModelId).toBe(input.catalogId);
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(2);
    expect(child.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
    child.emit('exit', 1, null);
    child.emit('error', new Error('stale child failed'));
    expect(manager.getStatus().status).toBe(StrataServiceStatus.Running);
    expect(manager.getStatus().activeModelId).toBe(input.catalogId);
  });

  test('same-catalog start after stop does not join the cancelled startup', async () => {
    const secondChild = new FakeChild();
    childProcessMock.spawn.mockReturnValueOnce(child).mockReturnValueOnce(secondChild);
    const manager = createManager();
    const firstStart = start(manager);
    await flush();
    const stopPromise = manager.stop();
    const nextStart = start(manager);
    strataClientMock.health.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(20_000);
    const [first, stopped, next] = await Promise.all([firstStart, stopPromise, nextStart]);

    expect(first.status).toBe(StrataServiceStatus.Stopped);
    expect(stopped.status).toBe(StrataServiceStatus.Stopped);
    expect(next.status).toBe(StrataServiceStatus.Running);
    expect(next.activeModelId).toBe(CATALOG_ID);
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(2);
  });

  test('start during stop waits for cleanup and is not overwritten by the stale stop', async () => {
    strataClientMock.health.mockResolvedValue(true);
    const firstChild = new FakeChild();
    const secondChild = new FakeChild();
    childProcessMock.spawn.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
    const manager = createManager();

    await start(manager);
    expect(manager.getStatus().status).toBe(StrataServiceStatus.Running);

    const events: string[] = [];
    manager.on('status', snapshot => events.push(snapshot.status));
    const stopPromise = manager.stop();
    await vi.advanceTimersByTimeAsync(0);
    const secondStart = start(manager);
    await vi.advanceTimersByTimeAsync(20_000);
    const [stopped, started] = await Promise.all([stopPromise, secondStart]);

    expect(stopped.status).toBe(StrataServiceStatus.Stopped);
    expect(started.status).toBe(StrataServiceStatus.Running);
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(2);
    expect(manager.getStatus().status).toBe(StrataServiceStatus.Running);
    expect(events.at(-1)).toBe(StrataServiceStatus.Running);
  });

  test('a late health result from before stop does not overwrite the stopped state', async () => {
    const manager = createManager();
    let resolveHealth: (healthy: boolean) => void = () => {};
    strataClientMock.health.mockImplementationOnce(
      () =>
        new Promise<boolean>(resolve => {
          resolveHealth = resolve;
        }),
    );

    const detectPromise = manager.detect();
    await flush();
    await manager.stop();
    resolveHealth(true);
    await detectPromise;

    expect(manager.getStatus().status).toBe(StrataServiceStatus.Stopped);
  });

  test('an old child exit does not overwrite a newer start', async () => {
    const firstChild = new FakeChild();
    const secondChild = new FakeChild();
    childProcessMock.spawn.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
    const manager = createManager();

    const firstStart = start(manager);
    await flush();
    const stopPromise = manager.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([firstStart, stopPromise]);

    const secondStart = start(manager);
    await flush();
    expect(manager.getStatus().status).toBe(StrataServiceStatus.Starting);

    firstChild.emit('exit', 0, null);
    expect(manager.getStatus().status).toBe(StrataServiceStatus.Starting);

    const secondStop = manager.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([secondStart, secondStop]);
  });
});
