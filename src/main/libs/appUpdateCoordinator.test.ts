import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { AppUpdateStatus } from '../../shared/appUpdate/constants';
import { APP_UPDATE_TRUSTED_KEYS } from '../../shared/appUpdate/trustedKeys';
import type { SqliteStore } from '../sqliteStore';
import { AppUpdateCoordinator } from './appUpdateCoordinator';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getVersion: () => '2026.7.1',
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
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

function signedManifest(privateKey: crypto.KeyObject) {
  const payload = {
    channel: 'stable',
    version: '2026.7.2',
    publishedAt: '2026-07-28T00:00:00.000Z',
    minimumSupportedVersion: '2026.7.1',
    mandatory: false,
    releaseNotes: {
      zh: { title: '测试版本', items: ['修复问题'] },
      en: { title: 'Test release', items: ['Bug fixes'] },
    },
    artifact: {
      platform: 'darwin',
      arch: 'arm64',
      variant: 'default',
      url: 'https://downloads.rongxzyai.com/releases/2026.7.2/darwin-arm64-default/ZhiYuan.dmg',
      size: 1024,
      sha256: 'a'.repeat(64),
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
  let privateKey: crypto.KeyObject;
  let publicKeyBase64: string;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
    Object.defineProperty(process, 'arch', { configurable: true, value: 'arm64' });
    const keyPair = crypto.generateKeyPairSync('ed25519');
    privateKey = keyPair.privateKey;
    publicKeyBase64 = keyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    (APP_UPDATE_TRUSTED_KEYS as Record<string, string>)['test-release-key'] = publicKeyBase64;
  });

  afterEach(() => {
    delete (APP_UPDATE_TRUSTED_KEYS as Record<string, string>)['test-release-key'];
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
    Object.defineProperty(process, 'arch', { configurable: true, value: originalArch });
    vi.unstubAllGlobals();
  });

  test('restores a verified available update from the cached envelope on 304', async () => {
    const store = new MemoryStore();
    const envelope = signedManifest(privateKey);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(envelope), {
          status: 200,
          headers: { 'content-type': 'application/json', etag: '"manifest-v1"' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetchMock);

    const coordinator = new AppUpdateCoordinator(store as unknown as SqliteStore);
    const firstResult = await coordinator.checkNow();
    const secondResult = await coordinator.checkNow();

    expect(firstResult.updateFound).toBe(true);
    expect(secondResult.updateFound).toBe(true);
    expect(secondResult.state.status).toBe(AppUpdateStatus.Available);
    expect(secondResult.state.info?.latestVersion).toBe('2026.7.2');
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      'if-none-match': '"manifest-v1"',
    });
  });

  test('restores a verified available update after an application restart', async () => {
    const store = new MemoryStore();
    const envelope = signedManifest(privateKey);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(envelope), {
          status: 200,
          headers: { 'content-type': 'application/json', etag: '"manifest-v1"' },
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
  });
});
