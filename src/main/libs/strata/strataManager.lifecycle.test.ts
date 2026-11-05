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
  child = new FakeChild();
  childProcessMock.spawn.mockReturnValue(child);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('StrataManager lifecycle', () => {
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
