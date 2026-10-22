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
  window: {
    isDestroyed: () => false,
    isVisible: () => true,
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  },
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
  BrowserWindow: { getAllWindows: () => [electronMocks.window] },
  shell: { openExternal: electronMocks.openExternal },
}));

const installerMocks = vi.hoisted(() => ({ installWindowsNsis: vi.fn() }));

vi.mock('./appUpdateInstaller', () => installerMocks);
const hasherMocks = vi.hoisted(() => ({ sha512UpdateFile: vi.fn() }));

vi.mock('./appUpdateFileHasher', () => hasherMocks);
vi.mock('./appUpdateInstallReceipt', () => ({ readInstallResult: () => null }));

import { AppUpdateCoordinator } from './appUpdateCoordinator';
import {
  ageReadyStatePastFreshnessWindow,
  manifestFetch,
  MemoryStore,
  signedManifest,
  updaterInfo,
} from './appUpdateCoordinator.testHarness';

describe('AppUpdateCoordinator electron-updater bridge', () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;
  let privateKey: crypto.KeyObject;
  let downloadedFile: string;
  let updaterSha512: string;

  /** Lets the pending electron-updater download complete with the fixture file. */
  const mockDownloadCompletes = (): void => {
    vi.mocked(updaterMocks.autoUpdater.downloadUpdate).mockImplementation(async () => {
      updaterMocks.emit('update-downloaded', { downloadedFile });
      return [downloadedFile];
    });
  };

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
    installerMocks.installWindowsNsis.mockReset();
    hasherMocks.sha512UpdateFile.mockReset();
    hasherMocks.sha512UpdateFile.mockImplementation(async (filePath: string) =>
      crypto
        .createHash('sha512')
        .update(await fs.promises.readFile(filePath))
        .digest('base64'),
    );
    electronMocks.getAppPath.mockReturnValue(process.cwd());
    electronMocks.isPackaged = false;
    electronMocks.openExternal.mockReset();
    electronMocks.window.hide.mockClear();
    electronMocks.window.show.mockClear();
    electronMocks.window.focus.mockClear();
  });

  afterEach(async () => {
    delete (APP_UPDATE_TRUSTED_KEYS as Record<string, string>)['test-release-key'];
    await fs.promises.rm(path.dirname(downloadedFile), { recursive: true, force: true });
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
    Object.defineProperty(process, 'arch', { configurable: true, value: originalArch });
    vi.useRealTimers();
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
    mockDownloadCompletes();

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

  test('reports verifying while the downloaded installer is hashed', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal('fetch', manifestFetch(envelope));
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    mockDownloadCompletes();
    let finishHash: ((digest: string) => void) | undefined;
    hasherMocks.sha512UpdateFile.mockImplementationOnce(
      () =>
        new Promise<string>(resolve => {
          finishHash = resolve;
        }),
    );
    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();

    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Verifying));
    expect(coordinator.getState().progress).toBeNull();
    await vi.waitFor(() => expect(hasherMocks.sha512UpdateFile).toHaveBeenCalledTimes(1));

    finishHash?.(updaterSha512);
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));
  });

  test('reports a capped fraction and drops it when the transfer counter restarts', async () => {
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

    updaterMocks.emit('download-progress', { transferred: 60, total: 100, bytesPerSecond: 10 });
    expect(coordinator.getState().progress).toMatchObject({ received: 60, percent: 0.6 });

    updaterMocks.emit('download-progress', { transferred: 100, total: 100, bytesPerSecond: 10 });
    expect(coordinator.getState().progress?.percent).toBe(0.99);

    // A differential download restarts its byte counter for the next batch; the
    // fraction no longer describes the whole transfer.
    updaterMocks.emit('download-progress', { transferred: 10, total: 100, bytesPerSecond: 10 });
    expect(coordinator.getState().progress?.percent).toBeUndefined();
    expect(coordinator.getState().progress?.received).toBe(10);
  });

  test('rehashes a restored ready update because this session never verified its bytes', async () => {
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
    vi.stubGlobal('fetch', manifestFetch(envelope));
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
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));

    const result = await coordinator.installReadyUpdate();

    expect(result.success).toBe(true);
    expect(hasherMocks.sha512UpdateFile).toHaveBeenCalledTimes(1);
    expect(installerMocks.installWindowsNsis).toHaveBeenCalledOnce();
  });

  test('uses the Windows NSIS handoff for a fresh ready update', async () => {
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
    vi.stubGlobal('fetch', manifestFetch(envelope));
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512, 'ZhiYuan.Setup.exe'),
    });
    mockDownloadCompletes();
    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));

    const result = await coordinator.installReadyUpdate();

    expect(result.success).toBe(true);
    expect(installerMocks.installWindowsNsis).toHaveBeenCalledWith(installerFile, '2026.7.2');
    expect(updaterMocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  test('keeps the verified Windows installer when handoff fails so retry does not download again', async () => {
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
    vi.stubGlobal('fetch', manifestFetch(envelope));
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512, 'ZhiYuan.Setup.exe'),
    });
    mockDownloadCompletes();
    installerMocks.installWindowsNsis.mockRejectedValueOnce(new Error('Installer handoff failed'));
    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));

    const install = await coordinator.installReadyUpdate();
    expect(install.success).toBe(false);
    expect(install.state.failureStage).toBe('install');
    expect((await coordinator.retryDownload()).status).toBe(AppUpdateStatus.Ready);
    expect(updaterMocks.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
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

  test('retries a failed check by checking again instead of requesting a download', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new Error('network unavailable'))
        .mockResolvedValue(new Response(JSON.stringify(envelope), { status: 200 })),
    );
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    vi.mocked(updaterMocks.autoUpdater.downloadUpdate).mockImplementation(
      () => new Promise(() => {}),
    );
    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    expect((await coordinator.checkNow()).state.failureStage).toBe('check');
    const state = await coordinator.retryDownload();
    expect(state.status).toBe(AppUpdateStatus.Downloading);
    expect(updaterMocks.autoUpdater.downloadUpdate).toHaveBeenCalledOnce();
  });

  test('keeps a verified file for a retry when the post-download freshness check fails', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(envelope), { status: 200 }))
        .mockRejectedValueOnce(new Error('network unavailable'))
        .mockResolvedValue(new Response(JSON.stringify(envelope), { status: 200 })),
    );
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    mockDownloadCompletes();
    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();
    await vi.waitFor(() => expect(coordinator.getState().failureStage).toBe('verify'));
    expect(updaterMocks.autoUpdater.downloadUpdate).toHaveBeenCalledOnce();
    const state = await coordinator.retryDownload();
    expect(state.status).toBe(AppUpdateStatus.Ready);
    expect(updaterMocks.autoUpdater.downloadUpdate).toHaveBeenCalledOnce();
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

  test('rejects a ready update whose file changed after verification instead of installing it', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal('fetch', manifestFetch(envelope));
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    mockDownloadCompletes();
    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));
    await fs.promises.writeFile(downloadedFile, 'tampered');

    const result = await coordinator.installReadyUpdate();

    expect(result.success).toBe(false);
    expect(result.state.status).toBe(AppUpdateStatus.Error);
    expect(hasherMocks.sha512UpdateFile).toHaveBeenCalledTimes(2);
    expect(electronMocks.window.hide).not.toHaveBeenCalled();
    expect(updaterMocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  test('installs a fresh ready update without another network round trip', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    const fetchMock = manifestFetch(envelope);
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    mockDownloadCompletes();
    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));

    const result = await coordinator.installReadyUpdate();

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(updaterMocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    // The digest computed after the download is reused instead of reading the
    // whole installer again on the click path.
    expect(hasherMocks.sha512UpdateFile).toHaveBeenCalledTimes(1);
    expect(electronMocks.window.hide).toHaveBeenCalledOnce();
    expect(updaterMocks.autoUpdater.quitAndInstall).toHaveBeenCalledOnce();
  });

  test('marks the install as in progress before the handoff resolves', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal('fetch', manifestFetch(envelope));
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    mockDownloadCompletes();
    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));

    const install = coordinator.installReadyUpdate();
    expect(coordinator.getState().status).toBe(AppUpdateStatus.Installing);
    await install;
  });

  test('coalesces concurrent install clicks into a single handoff', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal('fetch', manifestFetch(envelope));
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    mockDownloadCompletes();
    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));

    const [first, second] = await Promise.all([
      coordinator.installReadyUpdate(),
      coordinator.installReadyUpdate(),
    ]);

    expect(first).toBe(second);
    expect(updaterMocks.autoUpdater.quitAndInstall).toHaveBeenCalledOnce();
    expect(electronMocks.window.hide).toHaveBeenCalledOnce();
  });

  test('restores the window when the handoff fails after the install started', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal('fetch', manifestFetch(envelope));
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    mockDownloadCompletes();
    vi.mocked(updaterMocks.autoUpdater.quitAndInstall).mockImplementationOnce(() => {
      throw new Error('Handoff failed');
    });
    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));

    const result = await coordinator.installReadyUpdate();

    expect(result.success).toBe(false);
    expect(electronMocks.window.hide).toHaveBeenCalledOnce();
    expect(electronMocks.window.show).toHaveBeenCalledOnce();
    expect(coordinator.getState().status).toBe(AppUpdateStatus.Error);
  });

  test('rechecks an aged ready update before installing it', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    const fetchMock = manifestFetch(envelope);
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(updaterMocks.autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: updaterInfo('2026.7.2', updaterSha512),
    });
    mockDownloadCompletes();
    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));
    ageReadyStatePastFreshnessWindow();

    const result = await coordinator.installReadyUpdate();

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(updaterMocks.autoUpdater.quitAndInstall).toHaveBeenCalledOnce();
  });

  test('blocks installation and downloads a version published after the ready prompt aged', async () => {
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
    ageReadyStatePastFreshnessWindow();

    const result = await coordinator.installReadyUpdate();

    expect(result.success).toBe(false);
    expect(result.error).toContain('newer update');
    expect(result.state.status).toBe(AppUpdateStatus.Downloading);
    expect(result.state.info?.latestVersion).toBe('2026.7.3');
    expect(updaterMocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  test('does not reuse a ready file when the signed updater filename changes', async () => {
    const readyEnvelope = signedManifest(privateKey, { updaterSha512 });
    const renamedEnvelope = signedManifest(privateKey, {
      updaterSha512,
      updaterFilename: 'ZhiYuan-renamed.zip',
    });
    vi.stubGlobal('fetch', manifestFetch(readyEnvelope, readyEnvelope, renamedEnvelope));
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
        updateInfo: updaterInfo('2026.7.2', updaterSha512, 'ZhiYuan-renamed.zip'),
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
    ageReadyStatePastFreshnessWindow();

    const result = await coordinator.installReadyUpdate();

    expect(result.success).toBe(false);
    expect(result.state.status).toBe(AppUpdateStatus.Downloading);
    expect(result.state.info?.expectedUpdaterFileName).toBe('ZhiYuan-renamed.zip');
    expect(updaterMocks.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2);
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
    mockDownloadCompletes();
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

  test('never configures a feed or touches the network in enterprise builds', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const coordinator = new AppUpdateCoordinator(
      new MemoryStore() as unknown as SqliteStore,
      undefined,
      undefined,
      { enterpriseBuild: true },
    );

    const result = await coordinator.checkNow();

    expect(result).toMatchObject({ success: true, updateFound: false });
    expect(result.state.status).toBe(AppUpdateStatus.Idle);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updaterMocks.autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(updaterMocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  test('answers manual checks with an explicit message in enterprise builds', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const coordinator = new AppUpdateCoordinator(
      new MemoryStore() as unknown as SqliteStore,
      undefined,
      undefined,
      { enterpriseBuild: true },
    );

    const result = await coordinator.checkNow({ manual: true });

    expect(result.success).toBe(false);
    expect(result.updateFound).toBe(false);
    expect(result.error).toBe('This enterprise build does not provide online updates');
    expect(result.state.status).toBe(AppUpdateStatus.Idle);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updaterMocks.autoUpdater.setFeedURL).not.toHaveBeenCalled();
  });

  test('drops a cached ready update without a network recheck in enterprise builds', async () => {
    const store = new MemoryStore();
    store.set('app_update_ready_v2', {
      envelope: {},
      filePath: downloadedFile,
      sha512: updaterSha512,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const coordinator = new AppUpdateCoordinator(
      store as unknown as SqliteStore,
      undefined,
      undefined,
      { enterpriseBuild: true },
    );

    expect(coordinator.getState().status).toBe(AppUpdateStatus.Idle);
    expect(store.get('app_update_ready_v2')).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updaterMocks.autoUpdater.setFeedURL).not.toHaveBeenCalled();
  });

  test('refuses to install updates in enterprise builds', async () => {
    const coordinator = new AppUpdateCoordinator(
      new MemoryStore() as unknown as SqliteStore,
      undefined,
      undefined,
      { enterpriseBuild: true },
    );

    const result = await coordinator.installReadyUpdate();

    expect(result.success).toBe(false);
    expect(result.error).toBe('This enterprise build does not provide online updates');
    expect(result.state.status).toBe(AppUpdateStatus.Idle);
    expect(updaterMocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(installerMocks.installWindowsNsis).not.toHaveBeenCalled();
  });
});
