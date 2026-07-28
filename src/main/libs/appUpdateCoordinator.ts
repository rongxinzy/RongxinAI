import crypto from 'crypto';
import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { gt, lt, valid } from 'semver';

import {
  type AppUpdateCheckResult,
  type AppUpdateInfo,
  AppUpdateIpc,
  type AppUpdateRuntimeState,
  AppUpdateSource,
  AppUpdateStatus,
} from '../../shared/appUpdate/constants';
import { APP_UPDATE_TRUSTED_KEYS } from '../../shared/appUpdate/trustedKeys';
import type { SqliteStore } from '../sqliteStore';

const UPDATE_ENDPOINT = 'https://updates.rongxzyai.com/v1/updates/latest';
const DOWNLOAD_HOST = 'downloads.rongxzyai.com';
const MANIFEST_ETAG_KEY_PREFIX = 'app_update_manifest_etag';

type ManifestReleaseNotes = {
  zh?: { title?: unknown; items?: unknown };
  en?: { title?: unknown; items?: unknown };
};

type UpdatePayload = {
  channel?: unknown;
  version?: unknown;
  publishedAt?: unknown;
  minimumSupportedVersion?: unknown;
  mandatory?: unknown;
  releaseNotes?: ManifestReleaseNotes;
  artifact?: {
    platform?: unknown;
    arch?: unknown;
    variant?: unknown;
    url?: unknown;
    size?: unknown;
    sha256?: unknown;
  };
};

type SignedManifest = {
  schemaVersion?: unknown;
  keyId?: unknown;
  algorithm?: unknown;
  payload?: unknown;
  signature?: unknown;
};

const initialState = (): AppUpdateRuntimeState => ({
  status: AppUpdateStatus.Idle,
  source: null,
  info: null,
  progress: null,
  readyFilePath: null,
  readyFileHash: null,
  errorMessage: null,
});

function base64UrlToBuffer(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url value');
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function releaseNotes(value: ManifestReleaseNotes | undefined, language: 'zh' | 'en') {
  const notes = value?.[language];
  return {
    title: typeof notes?.title === 'string' ? notes.title : '',
    content: Array.isArray(notes?.items) ? notes.items.filter((item): item is string => typeof item === 'string') : [],
  };
}

export class AppUpdateCoordinator {
  private state: AppUpdateRuntimeState = initialState();
  private readonly store: SqliteStore;
  private checkPromise: Promise<AppUpdateCheckResult> | null = null;

  constructor(store: SqliteStore) {
    this.store = store;
  }

  getState(): AppUpdateRuntimeState {
    return { ...this.state };
  }

  async checkNow(options: { manual?: boolean } = {}): Promise<AppUpdateCheckResult> {
    if (this.isUpdateDisabled()) {
      return { success: true, state: this.setState(initialState()), updateFound: false };
    }
    if (this.checkPromise) return this.checkPromise;

    const source = options.manual ? AppUpdateSource.Manual : AppUpdateSource.Auto;
    this.checkPromise = this.checkForUpdate(source).finally(() => {
      this.checkPromise = null;
    });
    return this.checkPromise;
  }

  /** Phase 1 deliberately does not download or execute unsigned installers. */
  async retryDownload(): Promise<AppUpdateRuntimeState> {
    return this.getState();
  }

  cancelDownload(): AppUpdateRuntimeState {
    return this.getState();
  }

  async installReadyUpdate(): Promise<{ success: boolean; state: AppUpdateRuntimeState; error?: string }> {
    return { success: false, state: this.getState(), error: 'In-app installation is not enabled yet' };
  }

  private async checkForUpdate(source: AppUpdateSource): Promise<AppUpdateCheckResult> {
    this.setState({ ...initialState(), status: AppUpdateStatus.Checking, source });
    try {
      const currentVersion = this.resolveCurrentVersion();
      const info = await this.fetchUpdateInfo(currentVersion);
      if (!info) {
        const state = this.setState(initialState());
        return { success: true, state, updateFound: false };
      }
      const state = this.setState({
        ...initialState(),
        status: AppUpdateStatus.Available,
        source,
        info,
      });
      return { success: true, state, updateFound: true };
    } catch (error) {
      console.warn('[AppUpdate] update check failed:', error instanceof Error ? error.message : 'unknown');
      const state = this.setState(initialState());
      return {
        success: false,
        state,
        updateFound: false,
        error: error instanceof Error ? error.message : 'Update check failed',
      };
    }
  }

  private async fetchUpdateInfo(currentVersion: string): Promise<AppUpdateInfo | null> {
    const platform = process.platform;
    const arch = process.arch;
    const variant = this.resolveBuildVariant();
    if (!['win32', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch)) return null;

    const etagKey = `${MANIFEST_ETAG_KEY_PREFIX}:${platform}:${arch}:${variant}`;
    const etag = this.store.get<string>(etagKey);
    const url = new URL(UPDATE_ENDPOINT);
    url.searchParams.set('channel', 'stable');
    url.searchParams.set('platform', platform);
    url.searchParams.set('arch', arch);
    url.searchParams.set('variant', variant);

    const response = await fetch(url, {
      headers: etag ? { 'if-none-match': etag, accept: 'application/json' } : { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 304 || response.status === 404) return null;
    if (!response.ok) throw new Error(`Update service returned HTTP ${response.status}`);

    const envelope: unknown = await response.json();
    const payload = this.verifyAndDecodeManifest(envelope);
    const info = this.toUpdateInfo(payload, { platform, arch, variant });
    if (!info || !this.isNewerVersion(info.latestVersion, currentVersion)) return null;

    const receivedEtag = response.headers.get('etag');
    if (receivedEtag) this.store.set(etagKey, receivedEtag);
    return info;
  }

  private verifyAndDecodeManifest(value: unknown): UpdatePayload {
    if (!value || typeof value !== 'object') throw new Error('Invalid update manifest');
    const envelope = value as SignedManifest;
    if (
      envelope.schemaVersion !== 1 ||
      envelope.algorithm !== 'Ed25519' ||
      typeof envelope.keyId !== 'string' ||
      typeof envelope.payload !== 'string' ||
      typeof envelope.signature !== 'string'
    ) {
      throw new Error('Unsupported update manifest');
    }
    const trustedKey = APP_UPDATE_TRUSTED_KEYS[envelope.keyId];
    if (!trustedKey) throw new Error(`Unknown update signing key: ${envelope.keyId}`);

    const payloadBytes = base64UrlToBuffer(envelope.payload);
    const isValid = crypto.verify(
      null,
      payloadBytes,
      crypto.createPublicKey({ key: Buffer.from(trustedKey, 'base64'), format: 'der', type: 'spki' }),
      base64UrlToBuffer(envelope.signature),
    );
    if (!isValid) throw new Error('Update manifest signature verification failed');

    const payload: unknown = JSON.parse(payloadBytes.toString('utf8'));
    if (!payload || typeof payload !== 'object') throw new Error('Invalid update manifest payload');
    return payload as UpdatePayload;
  }

  private toUpdateInfo(
    payload: UpdatePayload,
    target: { platform: string; arch: string; variant: string },
  ): AppUpdateInfo | null {
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
      !/^[a-f0-9]{64}$/.test(artifact.sha256)
    ) {
      throw new Error('Update manifest payload failed validation');
    }

    const downloadUrl = new URL(artifact.url);
    const expectedExtension = target.platform === 'darwin' ? '.dmg' : '.exe';
    if (
      downloadUrl.protocol !== 'https:' ||
      downloadUrl.hostname !== DOWNLOAD_HOST ||
      !downloadUrl.pathname.startsWith('/releases/') ||
      !downloadUrl.pathname.toLowerCase().endsWith(expectedExtension)
    ) {
      throw new Error('Update artifact URL is not allowed');
    }

    const minimumSupportedVersion =
      typeof payload.minimumSupportedVersion === 'string' && valid(payload.minimumSupportedVersion)
        ? payload.minimumSupportedVersion
        : null;
    return {
      latestVersion: payload.version,
      date: typeof payload.publishedAt === 'string' ? payload.publishedAt : '',
      changeLog: { zh: releaseNotes(payload.releaseNotes, 'zh'), en: releaseNotes(payload.releaseNotes, 'en') },
      url: downloadUrl.toString(),
      expectedSize: artifact.size,
      expectedSha256: artifact.sha256,
      manualDownload: true,
      mandatory: payload.mandatory === true,
      minimumSupportedVersion,
    };
  }

  private resolveBuildVariant(): string {
    if (process.platform !== 'win32') return 'default';
    try {
      const packageJson = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as { zhiyuanUpdateVariant?: unknown };
      return packageJson.zhiyuanUpdateVariant === 'full' ? 'full' : 'lite';
    } catch {
      return 'lite';
    }
  }

  private isUpdateDisabled(): boolean {
    return this.store.get<{ disableUpdate?: boolean }>('enterprise_config')?.disableUpdate === true;
  }

  private resolveCurrentVersion(): string {
    const version = app.getVersion();
    if (!valid(version)) throw new Error(`Current application version is not SemVer: ${version}`);
    return version;
  }

  private isNewerVersion(latestVersion: string, currentVersion: string): boolean {
    return gt(latestVersion, currentVersion);
  }

  isMandatoryForCurrentVersion(): boolean {
    const info = this.state.info;
    return Boolean(info?.mandatory && info.minimumSupportedVersion && lt(this.resolveCurrentVersion(), info.minimumSupportedVersion));
  }

  private setState(nextState: AppUpdateRuntimeState): AppUpdateRuntimeState {
    this.state = { ...nextState };
    const snapshot = this.getState();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(AppUpdateIpc.StateChanged, snapshot);
    }
    return snapshot;
  }
}
