import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { AppUpdateStatus } from '../../shared/appUpdate/constants';
import { APP_UPDATE_TRUSTED_KEYS } from '../../shared/appUpdate/trustedKeys';
import type { SqliteStore } from '../sqliteStore';

const updaterMocks = vi.hoisted(() => {
  const listeners = new Map<string, ((...args: any[]) => void)[]>();
  class MockCancellationToken {
    cancelled = false;
    cancel = vi.fn(() => {
      this.cancelled = true;
    });
  }
  return {
    autoUpdater: {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      on: vi.fn((event: string, listener: (...args: any[]) => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      }),
      removeListener: vi.fn((event: string, listener: (...args: any[]) => void) => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter(registered => registered !== listener),
        );
      }),
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
    },
    CancellationToken: MockCancellationToken,
    emit(event: string, ...args: any[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    reset() {
      listeners.clear();
    },
  };
});

vi.mock('electron-updater', () => ({
  autoUpdater: updaterMocks.autoUpdater,
  CancellationToken: updaterMocks.CancellationToken,
}));

const electronMocks = vi.hoisted(() => ({
  getAppPath: vi.fn(() => process.cwd()),
  getPath: vi.fn(() => os.tmpdir()),
  isPackaged: false,
  openExternal: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getAppPath: electronMocks.getAppPath,
    getPath: electronMocks.getPath,
    getVersion: () => '2026.7.1',
    get isPackaged() {
      return electronMocks.isPackaged;
    },
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: electronMocks.openExternal },
}));

vi.mock('./appUpdateInstaller', () => ({ installWindowsNsis: vi.fn() }));

import { AppUpdateCoordinator } from './appUpdateCoordinator';

class MemoryStore {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.values.set(key, value);
  }

  delete(key: string): void {
    this.values.delete(key);
  }
}

const updaterInfo = (version: string, sha512: string, filename = 'ZhiYuan.zip') => ({
  version,
  files: [{ url: filename, sha512 }],
  path: filename,
  sha512,
  releaseDate: '2026-08-06T00:00:00.000Z',
});

function signedManifest(
  privateKey: crypto.KeyObject,
  options: {
    version?: string;
    updaterSha512?: string;
    platform?: string;
    arch?: string;
    variant?: string;
    updaterFilename?: string;
  } = {},
) {
  const version = options.version ?? '2026.7.2';
  const platform = options.platform ?? 'darwin';
  const arch = options.arch ?? 'arm64';
  const variant = options.variant ?? 'default';
  const updaterFilename = options.updaterFilename ?? 'ZhiYuan.zip';
  const payload = {
    channel: 'stable',
    version,
    publishedAt: '2026-08-06T00:00:00.000Z',
    minimumSupportedVersion: '2026.7.1',
    mandatory: false,
    artifact: {
      platform,
      arch,
      variant,
      // The old interface remains a DMG so pre-migration clients still work.
      url: `https://downloads.rongxzyai.com/releases/${version}/${platform}-${arch}-${variant}/ZhiYuan.dmg`,
      size: 1024,
      sha256: 'a'.repeat(64),
      updater: options.updaterSha512
        ? {
            sha512: options.updaterSha512,
            size: 27,
            filename: updaterFilename,
            url: `https://downloads.rongxzyai.com/releases/${version}/${platform}-${arch}-${variant}/${updaterFilename}`,
          }
        : undefined,
    },
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  return {
    schemaVersion: 1,
    keyId: 'test-release-key',
    algorithm: 'Ed25519',
    payload: payloadBytes.toString('base64url'),
    signature: crypto.sign(null, payloadBytes, privateKey).toString('base64url'),
  };
}

function manifestFetch(...envelopes: unknown[]) {
  let call = 0;
  return vi.fn(async () => {
    const envelope = envelopes[Math.min(call, envelopes.length - 1)];
    call += 1;
    return new Response(JSON.stringify(envelope), { status: 200 });
  });
}

describe('AppUpdateCoordinator electron-updater bridge', () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;
  let privateKey: crypto.KeyObject;
  let downloadedFile: string;
  let updaterSha512: string;

  beforeEach(async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
    Object.defineProperty(process, 'arch', { configurable: true, value: 'arm64' });
    const keyPair = crypto.generateKeyPairSync('ed25519');
    privateKey = keyPair.privateKey;
    (APP_UPDATE_TRUSTED_KEYS as Record<string, string>)['test-release-key'] = keyPair.publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64');
    downloadedFile = path.join(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-update-')),
      'ZhiYuan.zip',
    );
    const bytes = Buffer.from('electron-updater artifact');
    await fs.promises.writeFile(downloadedFile, bytes);
    updaterSha512 = crypto.createHash('sha512').update(bytes).digest('base64');
    updaterMocks.reset();
    vi.mocked(updaterMocks.autoUpdater.on).mockClear();
    vi.mocked(updaterMocks.autoUpdater.setFeedURL).mockReset();
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockReset();
    vi.mocked(updaterMocks.autoUpdater.downloadUpdate).mockReset();
    vi.mocked(updaterMocks.autoUpdater.quitAndInstall).mockReset();
    electronMocks.getAppPath.mockReturnValue(process.cwd());
    electronMocks.isPackaged = false;
    electronMocks.openExternal.mockReset();
  });

  afterEach(async () => {
    delete (APP_UPDATE_TRUSTED_KEYS as Record<string, string>)['test-release-key'];
    await fs.promises.rm(path.dirname(downloadedFile), { recursive: true, force: true });
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
    Object.defineProperty(process, 'arch', { configurable: true, value: originalArch });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test('requires the signed v1 authorization gate before downloading from the v2 feed', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal('fetch', manifestFetch(envelope));
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    vi.mocked(updaterMocks.autoUpdater.downloadUpdate).mockImplementation(async () => {
      updaterMocks.emit('download-progress', {
        transferred: 10,
        total: 20,
        bytesPerSecond: 5,
      });
      updaterMocks.emit('update-downloaded', { downloadedFile });
      return [downloadedFile];
    });

    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    const result = await coordinator.checkNow();

    expect(result.success).toBe(true);
    expect(result.updateFound).toBe(true);
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));
    expect(updaterMocks.autoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://updates.rongxzyai.com/v2/electron/stable/darwin/arm64/default/',
    });
    expect(updaterMocks.autoUpdater.downloadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ cancel: expect.any(Function) }),
    );
    expect(coordinator.getState().readyFileHash).toBe(updaterSha512);
  });

  test('does not expose restart update until the downloaded version is rechecked', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    let finishFreshnessCheck: ((response: Response) => void) | undefined;
    const freshnessResponse = new Promise<Response>(resolve => {
      finishFreshnessCheck = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(envelope), { status: 200 }))
      .mockImplementationOnce(() => freshnessResponse);
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    vi.mocked(updaterMocks.autoUpdater.downloadUpdate).mockImplementation(async () => {
      updaterMocks.emit('update-downloaded', { downloadedFile });
      return [downloadedFile];
    });

    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(coordinator.getState().status).toBe(AppUpdateStatus.Checking);
    expect(coordinator.getState().readyFilePath).toBeNull();

    finishFreshnessCheck?.(new Response(JSON.stringify(envelope), { status: 200 }));
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));
  });

  test('downloads a newly published version instead of exposing an older download as ready', async () => {
    const currentEnvelope = signedManifest(privateKey, { updaterSha512 });
    const newerSha512 = crypto.randomBytes(64).toString('base64');
    const newerEnvelope = signedManifest(privateKey, {
      version: '2026.7.3',
      updaterSha512: newerSha512,
    });
    vi.stubGlobal('fetch', manifestFetch(currentEnvelope, newerEnvelope));
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates)
      .mockResolvedValueOnce({
        isUpdateAvailable: true,
        updateInfo: updaterInfo('2026.7.2', updaterSha512),
      })
      .mockResolvedValueOnce({
        isUpdateAvailable: true,
        updateInfo: updaterInfo('2026.7.3', newerSha512),
      });
    vi.mocked(updaterMocks.autoUpdater.downloadUpdate)
      .mockImplementationOnce(async () => {
        updaterMocks.emit('update-downloaded', { downloadedFile });
        return [downloadedFile];
      })
      .mockImplementationOnce(() => new Promise(() => {}));

    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();

    await vi.waitFor(() => {
      expect(coordinator.getState().status).toBe(AppUpdateStatus.Downloading);
      expect(coordinator.getState().info?.latestVersion).toBe('2026.7.3');
    });
    expect(coordinator.getState().readyFilePath).toBeNull();
    expect(updaterMocks.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2);
  });

  test('rechecks a restored Windows installer before exposing restart update', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    Object.defineProperty(process, 'arch', { configurable: true, value: 'x64' });
    const installerFile = path.join(path.dirname(downloadedFile), 'ZhiYuan.Setup.exe');
    await fs.promises.rename(downloadedFile, installerFile);
    downloadedFile = installerFile;
    const envelope = signedManifest(privateKey, {
      updaterSha512,
      platform: 'win32',
      arch: 'x64',
      variant: 'lite',
      updaterFilename: 'ZhiYuan.Setup.exe',
    });
    let finishFreshnessCheck: ((response: Response) => void) | undefined;
    const freshnessResponse = new Promise<Response>(resolve => {
      finishFreshnessCheck = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => freshnessResponse),
    );
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512, 'ZhiYuan.Setup.exe'),
    });
    const store = new MemoryStore();
    store.set('app_update_ready_v2', {
      envelope,
      filePath: installerFile,
      sha512: updaterSha512,
    });

    const coordinator = new AppUpdateCoordinator(store as unknown as SqliteStore);

    expect(coordinator.getState().status).toBe(AppUpdateStatus.Checking);
    expect(coordinator.getState().readyFilePath).toBeNull();
    finishFreshnessCheck?.(new Response(JSON.stringify(envelope), { status: 200 }));
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));
  });

  test('rejects a v2 feed whose version or checksum is not authorized by the signed manifest', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal('fetch', manifestFetch(envelope));
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', crypto.randomBytes(64).toString('base64')),
    });

    const result = await new AppUpdateCoordinator(
      new MemoryStore() as unknown as SqliteStore,
    ).checkNow();

    expect(result.success).toBe(false);
    expect(updaterMocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  test('rejects a same-hash v2 file whose filename is not authorized', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal('fetch', manifestFetch(envelope));
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512, 'Other.zip'),
    });

    const result = await new AppUpdateCoordinator(
      new MemoryStore() as unknown as SqliteStore,
    ).checkNow();

    expect(result.success).toBe(false);
    expect(result.state.status).toBe(AppUpdateStatus.Error);
    expect(updaterMocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  test('rejects legacy manifests without electron-updater SHA-512 metadata', async () => {
    const envelope = signedManifest(privateKey);
    vi.stubGlobal('fetch', manifestFetch(envelope));

    const result = await new AppUpdateCoordinator(
      new MemoryStore() as unknown as SqliteStore,
    ).checkNow();

    expect(result.success).toBe(false);
    expect(updaterMocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  test('uses electron-updater CancellationToken to cancel an active download', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal('fetch', manifestFetch(envelope));
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    vi.mocked(updaterMocks.autoUpdater.downloadUpdate).mockImplementation(
      () => new Promise(() => {}),
    );

    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();
    const token = vi.mocked(updaterMocks.autoUpdater.downloadUpdate).mock.calls[0]?.[0] as {
      cancel: ReturnType<typeof vi.fn>;
    };
    const state = coordinator.cancelDownload();

    expect(token.cancel).toHaveBeenCalledOnce();
    expect(state.status).toBe(AppUpdateStatus.Available);
    expect(state.progress).toBeNull();
  });

  test('preserves active download progress when another update check is triggered', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    const fetchMock = manifestFetch(envelope);
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    vi.mocked(updaterMocks.autoUpdater.downloadUpdate).mockImplementation(
      () => new Promise(() => {}),
    );

    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();
    updaterMocks.emit('download-progress', {
      transferred: 10,
      total: 20,
      bytesPerSecond: 5,
    });

    const result = await coordinator.checkNow();

    expect(result.success).toBe(true);
    expect(result.updateFound).toBe(true);
    expect(result.state.status).toBe(AppUpdateStatus.Downloading);
    expect(result.state.progress?.percent).toBe(0.5);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(updaterMocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce();
  });

  test('marks a successful same-version check as up to date without reading the v2 feed', async () => {
    const envelope = signedManifest(privateKey, {
      version: '2026.7.1',
      updaterSha512,
    });
    vi.stubGlobal('fetch', manifestFetch(envelope));

    const result = await new AppUpdateCoordinator(
      new MemoryStore() as unknown as SqliteStore,
    ).checkNow({ manual: true });

    expect(result.success).toBe(true);
    expect(result.updateFound).toBe(false);
    expect(result.state.status).toBe(AppUpdateStatus.UpToDate);
    expect(updaterMocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  test('uses the signed manifest as a manual DMG fallback for unsigned packaged macOS builds', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal('fetch', manifestFetch(envelope));
    electronMocks.isPackaged = true;
    electronMocks.getAppPath.mockReturnValue(path.dirname(downloadedFile));
    await fs.promises.writeFile(
      path.join(path.dirname(downloadedFile), 'package.json'),
      JSON.stringify({ zhiyuanMacAutoUpdateEnabled: false }),
    );
    electronMocks.openExternal.mockResolvedValue(undefined);

    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    const result = await coordinator.checkNow({ manual: true });

    expect(result.success).toBe(true);
    expect(result.state.status).toBe(AppUpdateStatus.Available);
    expect(result.state.info?.manualDownloadOnly).toBe(true);
    expect(updaterMocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(updaterMocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled();

    await coordinator.retryDownload();
    expect(electronMocks.openExternal).toHaveBeenCalledWith(
      'https://downloads.rongxzyai.com/releases/2026.7.2/darwin-arm64-default/ZhiYuan.dmg',
    );
  });

  test('surfaces update check failures instead of returning to an unchecked idle state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network offline')));

    const result = await new AppUpdateCoordinator(
      new MemoryStore() as unknown as SqliteStore,
    ).checkNow({ manual: true });

    expect(result.success).toBe(false);
    expect(result.state.status).toBe(AppUpdateStatus.Error);
    expect(result.state.errorMessage).toBe('network offline');
  });

  test('rehashes a ready update immediately before installation', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal('fetch', manifestFetch(envelope));
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    vi.mocked(updaterMocks.autoUpdater.downloadUpdate).mockImplementation(async () => {
      updaterMocks.emit('update-downloaded', { downloadedFile });
      return [downloadedFile];
    });
    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));
    await fs.promises.writeFile(downloadedFile, 'tampered');

    const result = await coordinator.installReadyUpdate();

    expect(result.success).toBe(false);
    expect(result.state.status).toBe(AppUpdateStatus.Error);
    expect(updaterMocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  test('installs a ready update only after confirming it is still latest', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    const fetchMock = manifestFetch(envelope);
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    vi.mocked(updaterMocks.autoUpdater.downloadUpdate).mockImplementation(async () => {
      updaterMocks.emit('update-downloaded', { downloadedFile });
      return [downloadedFile];
    });
    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));

    const result = await coordinator.installReadyUpdate();

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(updaterMocks.autoUpdater.quitAndInstall).toHaveBeenCalledOnce();
  });

  test('blocks installation and downloads a version published after the ready prompt', async () => {
    const readyEnvelope = signedManifest(privateKey, { updaterSha512 });
    const newerSha512 = crypto.randomBytes(64).toString('base64');
    const newerEnvelope = signedManifest(privateKey, {
      version: '2026.7.3',
      updaterSha512: newerSha512,
    });
    vi.stubGlobal('fetch', manifestFetch(readyEnvelope, readyEnvelope, newerEnvelope));
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates)
      .mockResolvedValueOnce({
        isUpdateAvailable: true,
        updateInfo: updaterInfo('2026.7.2', updaterSha512),
      })
      .mockResolvedValueOnce({
        isUpdateAvailable: true,
        updateInfo: updaterInfo('2026.7.2', updaterSha512),
      })
      .mockResolvedValueOnce({
        isUpdateAvailable: true,
        updateInfo: updaterInfo('2026.7.3', newerSha512),
      });
    vi.mocked(updaterMocks.autoUpdater.downloadUpdate)
      .mockImplementationOnce(async () => {
        updaterMocks.emit('update-downloaded', { downloadedFile });
        return [downloadedFile];
      })
      .mockImplementationOnce(() => new Promise(() => {}));
    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));

    const result = await coordinator.installReadyUpdate();

    expect(result.success).toBe(false);
    expect(result.error).toContain('newer update');
    expect(result.state.status).toBe(AppUpdateStatus.Downloading);
    expect(result.state.info?.latestVersion).toBe('2026.7.3');
    expect(updaterMocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  test('revokes an active download when enterprise policy disables updates', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal('fetch', manifestFetch(envelope));
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    vi.mocked(updaterMocks.autoUpdater.downloadUpdate).mockImplementation(
      () => new Promise(() => {}),
    );
    const store = new MemoryStore();
    const coordinator = new AppUpdateCoordinator(store as unknown as SqliteStore);
    await coordinator.checkNow();
    const token = vi.mocked(updaterMocks.autoUpdater.downloadUpdate).mock.calls[0]?.[0] as {
      cancel: ReturnType<typeof vi.fn>;
    };

    store.set('enterprise_config', { disableUpdate: true });
    const state = coordinator.getState();

    expect(token.cancel).toHaveBeenCalledOnce();
    expect(state.status).toBe(AppUpdateStatus.Idle);
    expect(state.info).toBeNull();
  });

  test('rechecks enterprise policy before installing an already ready update', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal('fetch', manifestFetch(envelope));
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    vi.mocked(updaterMocks.autoUpdater.downloadUpdate).mockImplementation(async () => {
      updaterMocks.emit('update-downloaded', { downloadedFile });
      return [downloadedFile];
    });
    const store = new MemoryStore();
    const coordinator = new AppUpdateCoordinator(store as unknown as SqliteStore);
    await coordinator.checkNow();
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));

    store.set('enterprise_config', { disableUpdate: true });
    const result = await coordinator.installReadyUpdate();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Updates are disabled by enterprise policy');
    expect(result.state.status).toBe(AppUpdateStatus.Idle);
    expect(updaterMocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });
});
