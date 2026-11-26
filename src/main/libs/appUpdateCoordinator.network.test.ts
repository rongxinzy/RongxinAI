import { generateKeyPairSync } from 'node:crypto';
import { net } from 'electron';
import { expect, test, vi } from 'vitest';
import { AppUpdateStatus } from '../../shared/appUpdate/constants';
import { APP_UPDATE_TRUSTED_KEYS } from '../../shared/appUpdate/trustedKeys';
import type { SqliteStore } from '../sqliteStore';
import { AppUpdateCoordinator } from './appUpdateCoordinator';
import { manifestFetch, MemoryStore, signedManifest } from './appUpdateCoordinator.testHarness';

vi.mock('electron', () => ({
  app: { getVersion: () => '2026.7.1', getAppPath: () => process.cwd() },
  BrowserWindow: { getAllWindows: () => [] },
  net: { fetch: vi.fn() },
}));
vi.mock('electron-updater', () => ({
  autoUpdater: { on: vi.fn(), removeListener: vi.fn() },
}));
vi.mock('./appUpdateInstallReceipt', () => ({ readInstallResult: () => null }));

test('checks the signed manifest through Electron when direct Node networking fails', async () => {
  const platform = process.platform;
  const arch = process.arch;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  Object.defineProperty(process, 'arch', { value: 'arm64' });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const trustedKeys = APP_UPDATE_TRUSTED_KEYS as Record<string, string>;
  trustedKeys['test-release-key'] = publicKey
    .export({ format: 'der', type: 'spki' })
    .toString('base64');
  const directFetch = vi.fn().mockRejectedValue(new Error('Direct connection timed out'));
  vi.stubGlobal('fetch', directFetch);
  vi.mocked(net.fetch).mockImplementationOnce(
    manifestFetch(
      signedManifest(privateKey, {
        version: '2026.7.1',
        updaterSha512: Buffer.alloc(64, 1).toString('base64'),
      }),
    ),
  );
  const coordinator = new AppUpdateCoordinator(new MemoryStore() as unknown as SqliteStore);
  try {
    const result = await coordinator.checkNow({ manual: true });
    expect(result.success).toBe(true);
    expect(result.state.status).toBe(AppUpdateStatus.UpToDate);
    expect(net.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://updates.rongxzyai.com/v1/updates/latest?'),
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    );
    expect(directFetch).not.toHaveBeenCalled();
  } finally {
    coordinator.dispose();
    delete trustedKeys['test-release-key'];
    Object.defineProperty(process, 'platform', { value: platform });
    Object.defineProperty(process, 'arch', { value: arch });
    vi.unstubAllGlobals();
  }
});
