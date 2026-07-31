import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { AppUpdateStatus } from '../../shared/appUpdate/constants';
import { APP_UPDATE_TRUSTED_KEYS } from '../../shared/appUpdate/trustedKeys';
import type { SqliteStore } from '../sqliteStore';
import { downloadUpdate, installUpdate } from './appUpdateInstaller';
import { AppUpdateCoordinator } from './appUpdateCoordinator';

const electronMocks = vi.hoisted(() => ({
  getPath: vi.fn(() => os.tmpdir()),
}));

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: electronMocks.getPath,
    getVersion: () => '2026.7.1',
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

vi.mock('./appUpdateInstaller', () => ({
  cancelActiveDownload: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
}));

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

type ManifestTarget = {
  platform: 'darwin' | 'linux';
  arch: 'arm64' | 'x64';
  variant: 'appimage' | 'deb' | 'default';
  filename: string;
};

function signedManifest(
  privateKey: crypto.KeyObject,
  target: ManifestTarget = {
    platform: 'darwin',
    arch: 'arm64',
    variant: 'default',
    filename: 'ZhiYuan.dmg',
  },
  artifactOverrides: Partial<{
    version: string;
    size: number;
    sha256: string;
  }> = {},
) {
  const version = artifactOverrides.version ?? '2026.7.2';
  const payload = {
    channel: 'stable',
    version,
    publishedAt: '2026-07-28T00:00:00.000Z',
    minimumSupportedVersion: '2026.7.1',
    mandatory: false,
    releaseNotes: {
      zh: { title: '测试版本', items: ['修复问题'] },
      en: { title: 'Test release', items: ['Bug fixes'] },
    },
    artifact: {
      platform: target.platform,
      arch: target.arch,
      variant: target.variant,
      url: `https://downloads.rongxzyai.com/releases/${version}/${target.platform}-${target.arch}-${target.variant}/${target.filename}`,
      size: artifactOverrides.size ?? 1024,
      sha256: artifactOverrides.sha256 ?? 'a'.repeat(64),
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

describe('AppUpdateCoordinator manifest cache', () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;
  const originalAppImage = process.env.APPIMAGE;
  let privateKey: crypto.KeyObject;
  let publicKeyBase64: string;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin',
    });
    Object.defineProperty(process, 'arch', {
      configurable: true,
      value: 'arm64',
    });
    const keyPair = crypto.generateKeyPairSync('ed25519');
    privateKey = keyPair.privateKey;
    publicKeyBase64 = keyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    (APP_UPDATE_TRUSTED_KEYS as Record<string, string>)['test-release-key'] = publicKeyBase64;
    electronMocks.getPath.mockReturnValue(os.tmpdir());
    vi.mocked(downloadUpdate).mockResolvedValue({
      filePath: '/tmp/zhiyuan-update.dmg',
      sha256: 'a'.repeat(64),
    });
    vi.mocked(installUpdate).mockResolvedValue();
  });

  afterEach(() => {
    delete (APP_UPDATE_TRUSTED_KEYS as Record<string, string>)['test-release-key'];
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: originalPlatform,
    });
    Object.defineProperty(process, 'arch', {
      configurable: true,
      value: originalArch,
    });
    if (originalAppImage === undefined) {
      delete process.env.APPIMAGE;
    } else {
      process.env.APPIMAGE = originalAppImage;
    }
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test('refreshes the signed manifest while reusing a ready installer', async () => {
    const store = new MemoryStore();
    const envelope = signedManifest(privateKey);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(envelope), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            etag: '"manifest-v1"',
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetchMock);

    const coordinator = new AppUpdateCoordinator(store as unknown as SqliteStore);
    const firstResult = await coordinator.checkNow();
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));
    const secondResult = await coordinator.checkNow();

    expect(firstResult.updateFound).toBe(true);
    expect(secondResult.updateFound).toBe(true);
    expect(secondResult.state.status).toBe(AppUpdateStatus.Ready);
    expect(secondResult.state.info?.latestVersion).toBe('2026.7.2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(downloadUpdate).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'if-none-match': '"manifest-v1"' }),
      }),
    );
  });

  test('replaces a ready installer when the signed manifest advances again', async () => {
    const store = new MemoryStore();
    const firstEnvelope = signedManifest(privateKey);
    const nextSha256 = 'b'.repeat(64);
    const nextEnvelope = signedManifest(privateKey, undefined, {
      version: '2026.7.3',
      sha256: nextSha256,
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(firstEnvelope), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(nextEnvelope), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    );
    vi.mocked(downloadUpdate)
      .mockResolvedValueOnce({
        filePath: '/tmp/zhiyuan-update-2026.7.2.dmg',
        sha256: 'a'.repeat(64),
      })
      .mockResolvedValueOnce({
        filePath: '/tmp/zhiyuan-update-2026.7.3.dmg',
        sha256: nextSha256,
      });

    const coordinator = new AppUpdateCoordinator(store as unknown as SqliteStore);
    await coordinator.checkNow();
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));
    await coordinator.checkNow();
    await vi.waitFor(() =>
      expect(coordinator.getState()).toEqual(
        expect.objectContaining({
          status: AppUpdateStatus.Ready,
          readyFileHash: nextSha256,
          readyFilePath: '/tmp/zhiyuan-update-2026.7.3.dmg',
        }),
      ),
    );

    expect(coordinator.getState().info?.latestVersion).toBe('2026.7.3');
    expect(downloadUpdate).toHaveBeenCalledTimes(2);
  });

  test('restores ready metadata only when its signed envelope and update path are valid', async () => {
    const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-user-data-'));
    const updateDir = path.join(userDataDir, 'updates');
    const installerContents = Buffer.from('signed cached installer');
    const sha256 = crypto.createHash('sha256').update(installerContents).digest('hex');
    const installerPath = path.join(updateDir, 'zhiyuan.dmg');
    await fs.promises.mkdir(updateDir, { recursive: true });
    await fs.promises.writeFile(installerPath, installerContents);
    electronMocks.getPath.mockReturnValue(userDataDir);

    try {
      const store = new MemoryStore();
      const envelope = signedManifest(privateKey, undefined, {
        size: installerContents.length,
        sha256,
      });
      store.set('app_update_ready', {
        envelope,
        filePath: installerPath,
        sha256,
      });

      const restored = new AppUpdateCoordinator(store as unknown as SqliteStore);
      expect(restored.getState()).toEqual(
        expect.objectContaining({
          status: AppUpdateStatus.Ready,
          readyFilePath: installerPath,
          readyFileHash: sha256,
        }),
      );

      const tamperedStore = new MemoryStore();
      tamperedStore.set('app_update_ready', {
        envelope: { ...envelope, signature: 'A'.repeat(86) },
        filePath: installerPath,
        sha256,
      });
      const rejected = new AppUpdateCoordinator(tamperedStore as unknown as SqliteStore);
      expect(rejected.getState().status).toBe(AppUpdateStatus.Idle);
      expect(tamperedStore.get('app_update_ready')).toBeUndefined();

      const outsidePath = path.join(userDataDir, 'do-not-delete.dmg');
      await fs.promises.writeFile(outsidePath, installerContents);
      const outsideStore = new MemoryStore();
      outsideStore.set('app_update_ready', {
        envelope,
        filePath: outsidePath,
        sha256,
      });
      const outsideRejected = new AppUpdateCoordinator(outsideStore as unknown as SqliteStore);
      expect(outsideRejected.getState().status).toBe(AppUpdateStatus.Idle);
      await expect(fs.promises.readFile(outsidePath)).resolves.toEqual(installerContents);
    } finally {
      await fs.promises.rm(userDataDir, { recursive: true, force: true });
    }
  });

  test('restores a verified downloaded update after an application restart', async () => {
    const store = new MemoryStore();
    const envelope = signedManifest(privateKey);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(envelope), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            etag: '"manifest-v1"',
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetchMock);

    await new AppUpdateCoordinator(store as unknown as SqliteStore).checkNow();
    const restartedResult = await new AppUpdateCoordinator(
      store as unknown as SqliteStore,
    ).checkNow();

    expect(restartedResult.updateFound).toBe(true);
    expect(restartedResult.state.status).toBe(AppUpdateStatus.Available);
    await vi.waitFor(() => expect(downloadUpdate).toHaveBeenCalledTimes(2));
  });

  test.each([
    {
      name: 'AppImage',
      appImage: '/opt/zhiyuan/zhiyuan.AppImage',
      variant: 'appimage' as const,
      filename: 'ZhiYuan.AppImage',
    },
    {
      name: 'Ubuntu deb',
      appImage: undefined,
      variant: 'deb' as const,
      filename: 'zhiyuan_amd64.deb',
    },
  ])('selects the matching Linux $name update artifact', async target => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'linux',
    });
    Object.defineProperty(process, 'arch', {
      configurable: true,
      value: 'x64',
    });
    if (target.appImage) {
      process.env.APPIMAGE = target.appImage;
    } else {
      delete process.env.APPIMAGE;
    }

    const envelope = signedManifest(privateKey, {
      platform: 'linux',
      arch: 'x64',
      variant: target.variant,
      filename: target.filename,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(envelope), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AppUpdateCoordinator(
      new MemoryStore() as unknown as SqliteStore,
    ).checkNow();
    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));

    expect(result.updateFound).toBe(true);
    expect(result.state.info?.url).toContain(target.filename);
    expect(requestedUrl.searchParams.get('platform')).toBe('linux');
    expect(requestedUrl.searchParams.get('variant')).toBe(target.variant);
  });

  test('downloads a verified update in the background and only exposes it when ready', async () => {
    let resolveDownload: ((value: { filePath: string; sha256: string }) => void) | undefined;
    vi.mocked(downloadUpdate).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveDownload = resolve;
        }),
    );
    const envelope = signedManifest(privateKey);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(envelope), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    const result = await coordinator.checkNow();

    expect(result.updateFound).toBe(true);
    expect(coordinator.getState().status).toBe(AppUpdateStatus.Downloading);
    expect(downloadUpdate).toHaveBeenCalledWith(
      expect.stringContaining('/releases/2026.7.2/'),
      'auto',
      { size: 1024, sha256: 'a'.repeat(64) },
      expect.any(Function),
    );

    resolveDownload?.({
      filePath: '/tmp/zhiyuan-update.dmg',
      sha256: 'a'.repeat(64),
    });
    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));
    expect(coordinator.getState().readyFilePath).toBe('/tmp/zhiyuan-update.dmg');
  });

  test('does not expose a restart action when the background download fails', async () => {
    vi.mocked(downloadUpdate).mockRejectedValue(new Error('checksum verification failed'));
    const envelope = signedManifest(privateKey);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(envelope), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
    await coordinator.checkNow();

    await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Error));
    expect(coordinator.getState().readyFilePath).toBeNull();
    expect(coordinator.getState().errorMessage).toContain('checksum verification failed');
  });

  test('rechecks the cached installer hash before handing it to the installer', async () => {
    const installerContents = Buffer.from('verified installer');
    const sha256 = crypto.createHash('sha256').update(installerContents).digest('hex');
    const updateDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-update-test-'));
    const installerPath = path.join(updateDir, 'zhiyuan.dmg');
    await fs.promises.writeFile(installerPath, installerContents);
    vi.mocked(downloadUpdate).mockResolvedValue({
      filePath: installerPath,
      sha256,
    });
    const envelope = signedManifest(privateKey, undefined, {
      size: installerContents.length,
      sha256,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(envelope), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    try {
      const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
      await coordinator.checkNow();
      await vi.waitFor(() => expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready));

      const result = await coordinator.installReadyUpdate();
      expect(result.success).toBe(true);
      expect(installUpdate).toHaveBeenCalledWith(installerPath);
    } finally {
      await fs.promises.rm(updateDir, { recursive: true, force: true });
    }
  });
});
