import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { LocalCronClock } from '../../scheduledTask/localCronClock';
import type { CcConnectAccountConfig } from '../libs/ccConnectAccountConfig';
import { serializeCcConnectSidecarConfig } from '../libs/ccConnectSidecarConfig';
import { reconcileCcConnectChannelSidecars } from './ccConnectRuntime';
import { channelRuntime } from './channelRuntimeState';

const mocks = vi.hoisted(() => {
  class Sidecar {
    running = false;
    pid = 123;
    lastError = null;
    listeners = new Map<string, (event: unknown) => void>();
    start = vi.fn(async () => {
      this.running = true;
    });
    stop = vi.fn(async () => {
      await Promise.resolve();
      if (!this.running) return;
      this.running = false;
      this.listeners.get('exit')?.({ code: 0, signal: null });
    });
    waitForControlUrl = vi.fn(async () => 'http://127.0.0.1:54321');

    constructor() {
      sidecars.push(this);
    }

    on(event: string, listener: (event: unknown) => void): this {
      this.listeners.set(event, listener);
      return this;
    }
  }

  const sidecars: Sidecar[] = [];
  return {
    Sidecar,
    sidecars,
    accounts: [] as CcConnectAccountConfig[],
    existsSync: vi.fn(() => true),
    attach: vi.fn(),
    detach: vi.fn(),
  };
});

vi.mock('fs', () => ({
  default: {
    readFileSync: () => '{"binary":"cc-connect-sidecar"}',
    existsSync: mocks.existsSync,
  },
}));
vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/test/app',
    getPath: () => '/test/user-data',
  },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('./agentRuntimeState', () => ({ agentRuntime: {} }));
vi.mock('./runtimeServices', () => ({
  getStore: () => ({ getDatabase: () => ({}) }),
  getCoworkStore: () => ({ getWorkspace: () => ({}) }),
  getSkillManager: vi.fn(),
}));
vi.mock('./sessionServices', () => ({ getPiRuntimeAdapter: vi.fn() }));
vi.mock('../im/imStore', () => ({ IMStore: class {} }));
vi.mock('../libs/ccConnectAccountConfig', () => ({
  listCcConnectAccountConfigs: () => mocks.accounts,
}));
vi.mock('../libs/ccConnectSidecarManager', () => ({ CcConnectSidecarManager: mocks.Sidecar }));
vi.mock('../libs/ccConnectControlClient', () => ({
  CcConnectControlClient: class {
    async healthCheck() {
      return {
        platforms: mocks.accounts.map(account => ({ ...account, state: 'ready' })),
      };
    }
  },
}));
vi.mock('../../scheduledTask/ccConnectDeliveryClient', () => ({
  CcConnectDeliveryClient: class {},
}));
vi.mock('../../scheduledTask/ccConnectDeliveryTransport', () => ({
  CcConnectDeliveryTransport: class {
    attach = mocks.attach;
    detach = mocks.detach;
  },
}));
vi.mock('../../scheduledTask/canonicalScheduledTaskService', () => ({
  CanonicalScheduledTaskService: class {},
}));
vi.mock('../../scheduledTask/ccConnectSchedulerRuntime', () => ({
  CcConnectSchedulerRuntime: class {},
}));
vi.mock('../../scheduledTask/deliveryDispatcher', () => ({
  ScheduledTaskDeliveryDispatcher: class {},
}));
vi.mock('../../scheduledTask/sqliteScheduledTaskStore', () => ({
  SqliteScheduledTaskStore: class {},
}));
vi.mock('../../scheduledTask/piScheduledTaskExecutor', () => ({
  PiScheduledTaskExecutor: class {},
}));
vi.mock('../activity/activityService', () => ({ ActivityService: class {} }));
vi.mock('../im/channelAccountManager', () => ({ ChannelAccountManager: class {} }));
vi.mock('../im/ccConnectPiBridge', () => ({ CcConnectPiBridge: class {} }));
vi.mock('../im/channelInboxStore', () => ({ ChannelInboxStore: class {} }));
vi.mock('../im/channelTurnCoordinator', () => ({ ChannelTurnCoordinator: class {} }));
vi.mock('../libs/ccConnectBridgeServer', () => ({ CcConnectBridgeServer: class {} }));

const account = (accountId: string): CcConnectAccountConfig => ({
  accountId,
  platform: 'feishu',
  options: {},
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('process', { ...process, resourcesPath: '/test/resources' });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mocks.sidecars.length = 0;
  mocks.accounts = [];
  mocks.existsSync.mockReturnValue(true);
  mocks.attach.mockClear();
  mocks.detach.mockClear();
  channelRuntime.sidecarManager = null;
  channelRuntime.controlClient = null;
  channelRuntime.configSignature = '';
  channelRuntime.restartTimer = null;
  channelRuntime.restartAttempts = 0;
  channelRuntime.stopping = false;
  channelRuntime.reconcileQueue = Promise.resolve();
  channelRuntime.deliveryAccounts.clear();
  channelRuntime.statuses.clear();
  channelRuntime.bridgeServer = {} as NonNullable<typeof channelRuntime.bridgeServer>;
  channelRuntime.bridgeToken = 'synthetic-test-token';
  channelRuntime.bridgeUrl = 'http://127.0.0.1:54320';
  channelRuntime.schedulerClock = null;
  channelRuntime.deliveryTransport = {
    attach: mocks.attach,
    detach: mocks.detach,
  } as unknown as NonNullable<typeof channelRuntime.deliveryTransport>;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  channelRuntime.schedulerClock = null;
  channelRuntime.bridgeServer = null;
  channelRuntime.deliveryTransport = null;
});

test('leaves an empty channel configuration stopped without requiring a binary', async () => {
  mocks.existsSync.mockReturnValue(false);
  await expect(reconcileCcConnectChannelSidecars()).resolves.toBeUndefined();
  await expect(reconcileCcConnectChannelSidecars()).resolves.toBeUndefined();
  expect(mocks.sidecars).toHaveLength(0);
  expect(channelRuntime.sidecarManager).toBeNull();
  expect(console.error).not.toHaveBeenCalled();
});

test('cleans up the previous runtime when the last channel is disabled', async () => {
  mocks.accounts = [account('first')];
  await reconcileCcConnectChannelSidecars();
  const previous = mocks.sidecars[0];
  const restart = vi.fn();
  channelRuntime.restartTimer = setTimeout(restart, 1000);

  mocks.accounts = [];
  await expect(reconcileCcConnectChannelSidecars()).resolves.toBeUndefined();
  await vi.advanceTimersByTimeAsync(2000);

  expect(previous.stop).toHaveBeenCalledOnce();
  expect(mocks.sidecars).toHaveLength(1);
  expect(channelRuntime.sidecarManager).toBeNull();
  expect(channelRuntime.controlClient).toBeNull();
  expect(channelRuntime.deliveryAccounts.size).toBe(0);
  expect(mocks.detach).toHaveBeenCalledWith('first');
  expect(channelRuntime.statuses.get('first')).toMatchObject({
    connected: false,
    lastError: null,
  });
  expect(channelRuntime.configSignature).toBe('');
  expect(channelRuntime.restartTimer).toBeNull();
  expect(channelRuntime.stopping).toBe(false);
  expect(restart).not.toHaveBeenCalled();
});

test('starts once when the first account is enabled and reuses unchanged config', async () => {
  await reconcileCcConnectChannelSidecars();
  mocks.accounts = [account('first')];
  await reconcileCcConnectChannelSidecars();
  await reconcileCcConnectChannelSidecars();

  expect(mocks.sidecars).toHaveLength(1);
  expect(mocks.sidecars[0].start).toHaveBeenCalledOnce();
  expect(mocks.sidecars[0].stop).not.toHaveBeenCalled();
  expect(mocks.attach).toHaveBeenCalledOnce();
  expect(channelRuntime.statuses.get('first').connected).toBe(true);
});

test('keeps the existing local clock armed when the last channel is disabled', async () => {
  mocks.accounts = [account('first')];
  await reconcileCcConnectChannelSidecars();
  const fire = vi.fn();
  const clock = new LocalCronClock(fire);
  channelRuntime.schedulerClock = clock;
  clock.upsert({
    taskId: 'local-only',
    scheduleVersion: 'v1',
    schedule: { kind: 'at', at: new Date(Date.now() + 1000).toISOString() },
  });

  mocks.accounts = [];
  await reconcileCcConnectChannelSidecars();
  await vi.advanceTimersByTimeAsync(1000);

  expect(channelRuntime.schedulerClock).toBe(clock);
  expect(fire).toHaveBeenCalledOnce();
  expect(mocks.sidecars).toHaveLength(1);
});

test('still restarts and reattaches for a changed nonempty configuration', async () => {
  mocks.accounts = [account('first')];
  await reconcileCcConnectChannelSidecars();
  mocks.accounts = [account('second')];
  await reconcileCcConnectChannelSidecars();

  expect(mocks.sidecars).toHaveLength(2);
  expect(mocks.sidecars[0].stop).toHaveBeenCalledOnce();
  expect(mocks.sidecars[1].start).toHaveBeenCalledOnce();
  expect([...channelRuntime.deliveryAccounts]).toEqual(['second']);
  expect(channelRuntime.statuses.get('second').connected).toBe(true);
});

test('keeps the serializer strict for an invalid empty project list', () => {
  expect(() =>
    serializeCcConnectSidecarConfig({
      dataDir: '/test/runtime',
      bridgeUrl: 'http://127.0.0.1:54320',
      bridgeToken: 'synthetic-test-token',
      cronControlListen: '127.0.0.1:0',
      projects: [],
    }),
  ).toThrow('cc-connect sidecar config requires a project');
});

test('still reports missing runtime for valid accounts and recovers the queue', async () => {
  mocks.accounts = [account('first')];
  mocks.existsSync.mockReturnValue(false);
  await expect(reconcileCcConnectChannelSidecars()).rejects.toThrow(
    'cc-connect runtime is not bundled',
  );
  mocks.existsSync.mockReturnValue(true);
  await reconcileCcConnectChannelSidecars();
  expect(mocks.sidecars).toHaveLength(1);
  expect(mocks.sidecars[0].start).toHaveBeenCalledOnce();
});
