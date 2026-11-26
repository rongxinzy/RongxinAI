import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { InferenceEdition } from '../../shared/inferenceEdition';
import { AppUpdateReleaseChannel } from './appUpdateManifest';
import { electronUpdaterFeedOptions } from './appUpdateChannelPreference';
import { listRequiredReleaseTargets } from '../../../scripts/release/inference-edition-targets.mjs';

const packaged = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({
  app: { getAppPath: () => packaged.root, isPackaged: true },
}));
import { isElectronUpdaterEnabled, resolveBuildVariant } from './appUpdateBuildFlavor';

const originalPlatform = process.platform;
afterEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
  vi.unstubAllEnvs();
  if (packaged.root) fs.rmSync(packaged.root, { recursive: true, force: true });
  packaged.root = '';
});

test.each(listRequiredReleaseTargets())('matches the published target %s', target => {
  const [platform, arch, variant] = target.split(':');
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });
  vi.stubEnv('APPIMAGE', variant.startsWith('appimage-') ? '/opt/ZhiYuan.AppImage' : '');
  packaged.root = fs.mkdtempSync(path.join(os.tmpdir(), 'update-flavor-'));
  const edition = platform === 'linux' ? variant.split('-')[1] : variant;
  fs.writeFileSync(
    path.join(packaged.root, 'package.json'),
    JSON.stringify({ zhiyuanUpdateVariant: edition, zhiyuanMacAutoUpdateEnabled: true }),
  );
  expect(resolveBuildVariant()).toBe(variant);
  expect(isElectronUpdaterEnabled(platform)).toBe(true);
  expect(
    electronUpdaterFeedOptions(AppUpdateReleaseChannel.Stable, { platform, arch, variant }),
  ).toEqual({
    provider: 'generic',
    url: `https://updates.rongxzyai.com/v2/electron/stable/${platform}/${arch}/${variant}/`,
    useMultipleRangeRequest: false,
  });
});

test('keeps unsigned macOS builds on manual updates and rejects an unregistered Linux edition', () => {
  packaged.root = fs.mkdtempSync(path.join(os.tmpdir(), 'update-flavor-'));
  fs.writeFileSync(
    path.join(packaged.root, 'package.json'),
    JSON.stringify({
      zhiyuanUpdateVariant: InferenceEdition.Lite,
    }),
  );
  expect(isElectronUpdaterEnabled('darwin')).toBe(false);
  Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' });
  expect(() => resolveBuildVariant()).toThrow('packaged CUDA edition');
});
