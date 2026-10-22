/**
 * Reads the ready-update cache written after a verified Windows download.
 *
 * macOS and Linux let electron-updater manage their own installer cache, which
 * is not a stable API to reconstruct after a restart, so only Windows restores
 * a ready state from disk.
 */
import fs from 'node:fs';
import path from 'node:path';
import { gt } from 'semver';

import type { AppUpdateInfo } from '../../shared/appUpdate/constants';
import { isElectronUpdaterEnabled } from './appUpdateBuildFlavor';
import {
  type AppUpdateReleaseChannel,
  isSha512,
  toUpdateInfo,
  type UpdateTarget,
} from './appUpdateManifest';
import { verifyAndDecodeUpdateManifest } from './appUpdateSignedManifest';

export type ReadyUpdateCache = {
  envelope: unknown;
  filePath: string;
  sha512: string;
};

export type RestoredReadyUpdate = ReadyUpdateCache & {
  info: AppUpdateInfo;
};

/** Returns null for anything that is not a complete, newer, on-disk update. */
export function readReadyUpdateCache(options: {
  cached: unknown;
  target: UpdateTarget | null;
  channel: AppUpdateReleaseChannel;
  currentVersion: string;
}): RestoredReadyUpdate | null {
  try {
    const ready = options.cached as Partial<ReadyUpdateCache> | null;
    if (
      !ready ||
      typeof ready !== 'object' ||
      typeof ready.filePath !== 'string' ||
      !isSha512(ready.sha512) ||
      !ready.envelope ||
      typeof ready.envelope !== 'object' ||
      !options.target
    ) {
      return null;
    }
    const info = toUpdateInfo(
      verifyAndDecodeUpdateManifest(ready.envelope),
      options.target,
      isElectronUpdaterEnabled(options.target.platform),
      options.channel,
    );
    if (ready.sha512 !== info.expectedUpdaterSha512) return null;
    const resolvedFile = path.resolve(ready.filePath);
    if (path.basename(resolvedFile) !== info.expectedUpdaterFileName) return null;
    const stat = fs.statSync(resolvedFile);
    if (!stat.isFile() || stat.size === 0) return null;
    if (!gt(info.latestVersion, options.currentVersion)) return null;
    return { envelope: ready.envelope, filePath: resolvedFile, sha512: ready.sha512, info };
  } catch {
    return null;
  }
}
