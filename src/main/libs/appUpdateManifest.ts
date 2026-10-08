import { valid } from 'semver';

import type { AppUpdateInfo } from '../../shared/appUpdate/constants';

const DOWNLOAD_HOST = 'downloads.rongxzyai.com';

export type UpdateTarget = { platform: string; arch: string; variant: string };

export type UpdatePayload = {
  channel?: unknown;
  version?: unknown;
  publishedAt?: unknown;
  minimumSupportedVersion?: unknown;
  mandatory?: unknown;
  artifact?: {
    platform?: unknown;
    arch?: unknown;
    variant?: unknown;
    url?: unknown;
    size?: unknown;
    sha256?: unknown;
    updater?: { sha512?: unknown; size?: unknown; filename?: unknown };
  };
};

export function isSha512(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9+/]{86}(?:==)?$/.test(value);
}

export function toUpdateInfo(
  payload: UpdatePayload,
  target: UpdateTarget,
  electronUpdaterEnabled: boolean,
): AppUpdateInfo {
  const artifact = payload.artifact;
  if (
    payload.channel !== 'stable' ||
    typeof payload.version !== 'string' ||
    !valid(payload.version) ||
    !artifact ||
    artifact.platform !== target.platform ||
    artifact.arch !== target.arch ||
    artifact.variant !== target.variant ||
    typeof artifact.url !== 'string' ||
    typeof artifact.size !== 'number' ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size <= 0 ||
    typeof artifact.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
    !artifact.updater ||
    !isSha512(artifact.updater.sha512) ||
    typeof artifact.updater.size !== 'number' ||
    !Number.isSafeInteger(artifact.updater.size) ||
    artifact.updater.size <= 0 ||
    typeof artifact.updater.filename !== 'string' ||
    artifact.updater.filename.length > 240 ||
    /[\\/\u0000-\u001f\u007f]/.test(artifact.updater.filename) ||
    artifact.updater.filename === '.' ||
    artifact.updater.filename === '..'
  ) {
    throw new Error('Update manifest is missing electron-updater integrity metadata');
  }
  const downloadUrl = new URL(artifact.url);
  if (
    downloadUrl.protocol !== 'https:' ||
    downloadUrl.hostname !== DOWNLOAD_HOST ||
    !downloadUrl.pathname.startsWith('/releases/')
  ) {
    throw new Error('Update artifact URL is not allowed');
  }
  const minimumSupportedVersion =
    typeof payload.minimumSupportedVersion === 'string' && valid(payload.minimumSupportedVersion)
      ? payload.minimumSupportedVersion
      : null;
  return {
    latestVersion: payload.version,
    url: downloadUrl.toString(),
    expectedSize: artifact.size,
    expectedSha256: artifact.sha256,
    expectedUpdaterSha512: artifact.updater.sha512,
    expectedUpdaterFileName: artifact.updater.filename,
    manualDownloadOnly: !electronUpdaterEnabled,
    mandatory: payload.mandatory === true,
    minimumSupportedVersion,
  };
}
