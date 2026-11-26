import { generateKeyPairSync } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { APP_UPDATE_TRUSTED_KEYS } from '../../shared/appUpdate/trustedKeys';
import type { SqliteStore } from '../sqliteStore';
import { AppUpdateCoordinator } from './appUpdateCoordinator';
import {
  manifestFetch,
  MemoryStore,
  signedManifest,
  updaterInfo,
} from './appUpdateCoordinator.testHarness';

vi.mock('electron', () => ({
  app: { getVersion: () => '2026.7.1', getAppPath: () => process.cwd() },
  BrowserWindow: { getAllWindows: () => [] },
  net: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
}));
vi.mock('electron-updater', () => ({}));
vi.mock('./appUpdateInstallReceipt', () => ({ readInstallResult: () => null }));

const platform = process.platform;
const arch = process.arch;
const trustedKeys = APP_UPDATE_TRUSTED_KEYS as Record<string, string>;

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: platform });
  Object.defineProperty(process, 'arch', { value: arch });
  delete trustedKeys['test-release-key'];
  vi.unstubAllGlobals();
});

test('shutdown releases a stuck update feed check and ignores its late result', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  Object.defineProperty(process, 'arch', { value: 'arm64' });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  trustedKeys['test-release-key'] = publicKey
    .export({ format: 'der', type: 'spki' })
    .toString('base64');
  const updaterSha512 = Buffer.alloc(64, 1).toString('base64');
  vi.stubGlobal('fetch', manifestFetch(signedManifest(privateKey, { updaterSha512 })));

  const entered = Promise.withResolvers<void>();
  type Updater = NonNullable<ConstructorParameters<typeof AppUpdateCoordinator>[1]>;
  const feed = Promise.withResolvers<Awaited<ReturnType<Updater['checkForUpdates']>>>();
  const updater: Updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: vi.fn(),
    removeListener: vi.fn(),
    setFeedURL: vi.fn(),
    checkForUpdates: () => {
      entered.resolve();
      return feed.promise;
    },
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  };
  const coordinator = new AppUpdateCoordinator(
    new MemoryStore() as unknown as SqliteStore,
    updater,
  );
  const checking = coordinator.checkNow();
  await entered.promise;
  const stopped = vi.fn();
  const stopping = coordinator.shutdown().then(stopped);
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(stopped).toHaveBeenCalledOnce();
  } finally {
    const updateInfo = updaterInfo('2026.7.2', updaterSha512);
    feed.resolve({ isUpdateAvailable: true, updateInfo, versionInfo: updateInfo });
    await Promise.all([checking, stopping]);
  }
  expect(updater.downloadUpdate).not.toHaveBeenCalled();
});
