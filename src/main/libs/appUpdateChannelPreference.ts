import { AppUpdateChannelPreference } from '../../shared/appUpdate/constants';
import type { SqliteStore } from '../sqliteStore';
import { AppUpdateReleaseChannel, type UpdateTarget } from './appUpdateManifest';

const APP_UPDATE_CHANNEL_STORE_KEY = 'app_update_channel';

const ELECTRON_UPDATE_FEED_BASE = 'https://updates.rongxzyai.com/v2/electron';
const MANIFEST_CACHE_KEY_PREFIX = 'app_update_manifest_cache';

export const readChannelPreference = (store: SqliteStore): AppUpdateReleaseChannel => {
  const stored = store.get<string>(APP_UPDATE_CHANNEL_STORE_KEY);
  return stored === AppUpdateChannelPreference.Beta
    ? AppUpdateReleaseChannel.Beta
    : AppUpdateReleaseChannel.Stable;
};

export const writeChannelPreference = (
  store: SqliteStore,
  channel: AppUpdateChannelPreference,
): void => {
  if (
    channel !== AppUpdateChannelPreference.Stable &&
    channel !== AppUpdateChannelPreference.Beta
  ) {
    throw new Error('Unsupported update channel preference');
  }
  const releaseChannel =
    channel === AppUpdateChannelPreference.Beta
      ? AppUpdateReleaseChannel.Beta
      : AppUpdateReleaseChannel.Stable;
  store.set(APP_UPDATE_CHANNEL_STORE_KEY, releaseChannel);
};

export const manifestCacheKeyForChannel = (
  channel: AppUpdateReleaseChannel,
  target: UpdateTarget,
): string => {
  const { platform, arch, variant } = target;
  return `${MANIFEST_CACHE_KEY_PREFIX}:${channel}:${platform}:${arch}:${variant}`;
};

export const electronUpdaterFeedUrl = (
  channel: AppUpdateReleaseChannel,
  target: UpdateTarget,
): string => {
  const feedUrl = new URL(
    `${target.platform}/${target.arch}/${target.variant}/`,
    `${ELECTRON_UPDATE_FEED_BASE}/${channel}/`,
  );
  return feedUrl.toString();
};
