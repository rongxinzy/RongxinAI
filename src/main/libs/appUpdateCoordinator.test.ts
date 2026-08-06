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
  getPath: vi.fn(() => os.tmpdir()),
}));

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: electronMocks.getPath,
    getVersion: () => '2026.7.1',
  },
  BrowserWindow: { getAllWindows: () => [] },
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
  options: { version?: string; updaterSha512?: string } = {},
) {
  const payload = {
    channel: 'stable',
    version: options.version ?? '2026.7.2',
    publishedAt: '2026-08-06T00:00:00.000Z',
    minimumSupportedVersion: '2026.7.1',
    mandatory: false,
    artifact: {
      platform: 'darwin',
      arch: 'arm64',
      variant: 'default',
      // The old interface remains a DMG so pre-migration clients still work.
      url: 'https://downloads.rongxzyai.com/releases/2026.7.2/darwin-arm64-default/ZhiYuan.dmg',
      size: 1024,
      sha256: 'a'.repeat(64),
      updater: options.updaterSha512
        ? {
            sha512: options.updaterSha512,
            size: 27,
            filename: 'ZhiYuan.zip',
            url: 'https://downloads.rongxzyai.com/releases/2026.7.2/darwin-arm64-default/ZhiYuan.zip',
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope), { status: 200 })),
    );
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

  test('rejects a v2 feed whose version or checksum is not authorized by the signed manifest', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope), { status: 200 })),
    );
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope), { status: 200 })),
    );
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope), { status: 200 })),
    );

    const result = await new AppUpdateCoordinator(
      new MemoryStore() as unknown as SqliteStore,
    ).checkNow();

    expect(result.success).toBe(false);
    expect(updaterMocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  test('uses electron-updater CancellationToken to cancel an active download', async () => {
    const envelope = signedManifest(privateKey, { updaterSha512 });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope), { status: 200 })),
    );
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
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(envelope), { status: 200 }),
    );
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope), { status: 200 })),
    );

    const result = await new AppUpdateCoordinator(
      new MemoryStore() as unknown as SqliteStore,
    ).checkNow({ manual: true });

    expect(result.success).toBe(true);
    expect(result.updateFound).toBe(false);
    expect(result.state.status).toBe(AppUpdateStatus.UpToDate);
    expect(updaterMocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope), { status: 200 })),
    );
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
});
