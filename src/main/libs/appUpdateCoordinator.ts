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
import { cancelActiveDownload, downloadUpdate, installUpdate } from './appUpdateInstaller';
import type { SqliteStore } from '../sqliteStore';

const UPDATE_ENDPOINT = 'https://updates.rongxzyai.com/v1/updates/latest';
const DOWNLOAD_HOST = 'downloads.rongxzyai.com';
const MANIFEST_CACHE_KEY_PREFIX = 'app_update_manifest_cache';
const READY_UPDATE_CACHE_KEY = 'app_update_ready';
const SUPPORTED_UPDATE_PLATFORMS = new Set(['win32', 'darwin', 'linux']);
const SUPPORTED_UPDATE_ARCHITECTURES = new Set(['x64', 'arm64']);

type UpdatePayload = {
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
  };
};

type SignedManifest = {
  schemaVersion?: unknown;
  keyId?: unknown;
  algorithm?: unknown;
  payload?: unknown;
  signature?: unknown;
};

type CachedSignedManifest = {
  etag: string;
  envelope: unknown;
};

type ReadyUpdateCache = {
  envelope: unknown;
  filePath: string;
  sha256: string;
};

type VerifiedUpdate = {
  envelope: unknown;
  info: AppUpdateInfo;
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

export class AppUpdateCoordinator {
  private state: AppUpdateRuntimeState = initialState();
  private readonly store: SqliteStore;
  private checkPromise: Promise<AppUpdateCheckResult> | null = null;
  private downloadPromise: Promise<void> | null = null;
  private currentSignedEnvelope: unknown | null = null;

  constructor(store: SqliteStore) {
    this.store = store;
    this.restoreReadyUpdate();
  }

  getState(): AppUpdateRuntimeState {
    return { ...this.state };
  }

  async checkNow(options: { manual?: boolean } = {}): Promise<AppUpdateCheckResult> {
    if (this.isUpdateDisabled()) {
      this.currentSignedEnvelope = null;
      return {
        success: true,
        state: this.setState(initialState()),
        updateFound: false,
      };
    }
    if (this.checkPromise) return this.checkPromise;

    const source = options.manual ? AppUpdateSource.Manual : AppUpdateSource.Auto;
    this.checkPromise = this.checkForUpdate(source).finally(() => {
      this.checkPromise = null;
    });
    return this.checkPromise;
  }

  async retryDownload(): Promise<AppUpdateRuntimeState> {
    const info = this.state.info;
    if (!info || this.downloadPromise || this.state.status === AppUpdateStatus.Installing) {
      return this.getState();
    }
    if (!this.currentSignedEnvelope) {
      void this.checkNow({ manual: true });
      return this.getState();
    }
    this.startBackgroundDownload(
      { info, envelope: this.currentSignedEnvelope },
      this.state.source ?? AppUpdateSource.Manual,
    );
    return this.getState();
  }

  cancelDownload(): AppUpdateRuntimeState {
    if (this.state.status === AppUpdateStatus.Downloading) {
      cancelActiveDownload();
      this.setState({
        ...initialState(),
        status: AppUpdateStatus.Available,
        source: this.state.source,
        info: this.state.info,
      });
    }
    return this.getState();
  }

  async installReadyUpdate(): Promise<{
    success: boolean;
    state: AppUpdateRuntimeState;
    error?: string;
  }> {
    const { readyFilePath, readyFileHash, info, source } = this.state;
    if (!readyFilePath || !readyFileHash || !info) {
      return {
        success: false,
        state: this.getState(),
        error: 'No verified update is ready',
      };
    }

    try {
      const stat = await fs.promises.stat(readyFilePath);
      if (stat.size !== info.expectedSize)
        throw new Error('Downloaded update file is no longer valid');
      const actualHash = await this.sha256File(readyFilePath);
      if (actualHash !== readyFileHash || actualHash !== info.expectedSha256) {
        throw new Error('Downloaded update checksum verification failed');
      }
      this.setState({
        ...this.state,
        status: AppUpdateStatus.Installing,
        progress: null,
        errorMessage: null,
      });
      await installUpdate(readyFilePath);
      return { success: true, state: this.getState() };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update installation failed';
      const state = this.setState({
        ...initialState(),
        status: AppUpdateStatus.Error,
        source,
        info,
        readyFilePath,
        readyFileHash,
        errorMessage: message,
      });
      return { success: false, state, error: message };
    }
  }

  private async checkForUpdate(source: AppUpdateSource): Promise<AppUpdateCheckResult> {
    const previousReady = this.state.status === AppUpdateStatus.Ready ? this.getState() : null;
    const previousEnvelope = this.currentSignedEnvelope;
    this.setState({
      ...initialState(),
      status: AppUpdateStatus.Checking,
      source,
    });
    try {
      const currentVersion = this.resolveCurrentVersion();
      const update = await this.fetchUpdateInfo(currentVersion);
      if (!update) {
        this.currentSignedEnvelope = null;
        if (previousReady?.readyFilePath) this.discardReadyUpdate(previousReady.readyFilePath);
        const state = this.setState(initialState());
        return { success: true, state, updateFound: false };
      }
      if (
        previousReady?.info?.latestVersion === update.info.latestVersion &&
        previousReady.readyFilePath &&
        previousReady.readyFileHash === update.info.expectedSha256
      ) {
        this.currentSignedEnvelope = update.envelope;
        this.store.set<ReadyUpdateCache>(READY_UPDATE_CACHE_KEY, {
          envelope: update.envelope,
          filePath: previousReady.readyFilePath,
          sha256: previousReady.readyFileHash,
        });
        return {
          success: true,
          state: this.setState(previousReady),
          updateFound: true,
        };
      }
      this.currentSignedEnvelope = update.envelope;
      const state = this.setState({
        ...initialState(),
        status: AppUpdateStatus.Available,
        source,
        info: update.info,
      });
      this.startBackgroundDownload(update, source, previousReady?.readyFilePath ?? undefined);
      return { success: true, state, updateFound: true };
    } catch (error) {
      console.warn(
        '[AppUpdate] update check failed:',
        error instanceof Error ? error.message : 'unknown',
      );
      if (previousReady) {
        this.currentSignedEnvelope = previousEnvelope;
      }
      const state = this.setState(previousReady ?? initialState());
      return {
        success: false,
        state,
        updateFound: false,
        error: error instanceof Error ? error.message : 'Update check failed',
      };
    }
  }

  private startBackgroundDownload(
    update: VerifiedUpdate,
    source: AppUpdateSource,
    supersededFilePath?: string,
  ): void {
    if (this.downloadPromise) return;
    const { envelope, info } = update;
    this.setState({
      ...initialState(),
      status: AppUpdateStatus.Downloading,
      source,
      info,
    });
    this.downloadPromise = downloadUpdate(
      info.url,
      source,
      { size: info.expectedSize, sha256: info.expectedSha256 },
      progress => {
        this.setState({ ...this.state, progress });
      },
    )
      .then(({ filePath, sha256 }) => {
        const readyUpdate: ReadyUpdateCache = { envelope, filePath, sha256 };
        this.store.set<ReadyUpdateCache>(READY_UPDATE_CACHE_KEY, readyUpdate);
        this.currentSignedEnvelope = envelope;
        this.setState({
          ...initialState(),
          status: AppUpdateStatus.Ready,
          source,
          info,
          readyFilePath: filePath,
          readyFileHash: sha256,
        });
        if (supersededFilePath && supersededFilePath !== filePath) {
          void fs.promises.unlink(supersededFilePath).catch(() => {});
        }
      })
      .catch(error => {
        if (
          this.state.status !== AppUpdateStatus.Downloading ||
          this.state.info?.latestVersion !== info.latestVersion
        ) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Update download failed';
        console.warn('[AppUpdate] background download failed:', message);
        this.setState({
          ...initialState(),
          status: AppUpdateStatus.Error,
          source,
          info,
          errorMessage: message,
        });
      })
      .finally(() => {
        this.downloadPromise = null;
      });
  }

  private restoreReadyUpdate(): void {
    const cached = this.store.get<unknown>(READY_UPDATE_CACHE_KEY);
    if (!this.isReadyUpdateCache(cached)) {
      if (cached !== undefined) this.store.delete(READY_UPDATE_CACHE_KEY);
      return;
    }
    try {
      const payload = this.verifyAndDecodeManifest(cached.envelope);
      const target = this.resolveUpdateTarget();
      if (!target) throw new Error('unsupported update target');
      const info = this.toUpdateInfo(payload, target);
      if (!info || info.expectedSha256 !== cached.sha256) throw new Error('manifest mismatch');
      const updateDir = path.resolve(app.getPath('userData'), 'updates');
      const resolvedFilePath = path.resolve(cached.filePath);
      if (!resolvedFilePath.startsWith(`${updateDir}${path.sep}`)) {
        throw new Error('installer path is outside the update directory');
      }
      const stat = fs.statSync(resolvedFilePath);
      if (stat.size !== info.expectedSize) throw new Error('size mismatch');
      if (!this.isNewerVersion(info.latestVersion, this.resolveCurrentVersion())) {
        throw new Error('not newer than the running app');
      }
      this.currentSignedEnvelope = cached.envelope;
      this.state = {
        ...initialState(),
        status: AppUpdateStatus.Ready,
        source: AppUpdateSource.Auto,
        info,
        readyFilePath: resolvedFilePath,
        readyFileHash: cached.sha256,
      };
    } catch {
      this.store.delete(READY_UPDATE_CACHE_KEY);
    }
  }

  private isReadyUpdateCache(value: unknown): value is ReadyUpdateCache {
    if (!value || typeof value !== 'object') return false;
    const cached = value as ReadyUpdateCache;
    return (
      typeof cached.filePath === 'string' &&
      /^[a-f0-9]{64}$/.test(cached.sha256) &&
      Boolean(cached.envelope) &&
      typeof cached.envelope === 'object'
    );
  }

  private discardReadyUpdate(filePath: string): void {
    this.store.delete(READY_UPDATE_CACHE_KEY);
    const updateDir = path.resolve(app.getPath('userData'), 'updates');
    const resolvedFilePath = path.resolve(filePath);
    if (resolvedFilePath.startsWith(`${updateDir}${path.sep}`)) {
      void fs.promises.unlink(resolvedFilePath).catch(() => {});
    }
  }

  private async sha256File(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) {
      hash.update(chunk);
    }
    return hash.digest('hex');
  }

  private async fetchUpdateInfo(currentVersion: string): Promise<VerifiedUpdate | null> {
    const target = this.resolveUpdateTarget();
    if (!target) return null;
    const { platform, arch, variant } = target;

    const cacheKey = `${MANIFEST_CACHE_KEY_PREFIX}:${platform}:${arch}:${variant}`;
    const cachedManifest = this.readCachedManifest(cacheKey);
    const url = new URL(UPDATE_ENDPOINT);
    url.searchParams.set('channel', 'stable');
    url.searchParams.set('platform', platform);
    url.searchParams.set('arch', arch);
    url.searchParams.set('variant', variant);

    const response = await fetch(url, {
      headers: cachedManifest
        ? { 'if-none-match': cachedManifest.etag, accept: 'application/json' }
        : { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) {
      this.store.delete(cacheKey);
      return null;
    }
    if (response.status === 304 && !cachedManifest) {
      throw new Error('Update service returned 304 without a cached manifest');
    }
    if (response.status !== 304 && !response.ok) {
      throw new Error(`Update service returned HTTP ${response.status}`);
    }

    const envelope: unknown =
      response.status === 304 ? cachedManifest?.envelope : await response.json();
    const payload = this.verifyAndDecodeManifest(envelope);
    const info = this.toUpdateInfo(payload, target);

    if (response.status !== 304) {
      const receivedEtag = response.headers.get('etag');
      if (receivedEtag) {
        this.store.set<CachedSignedManifest>(cacheKey, {
          etag: receivedEtag,
          envelope,
        });
      } else {
        this.store.delete(cacheKey);
      }
    }
    if (!info || !this.isNewerVersion(info.latestVersion, currentVersion)) return null;
    return { envelope, info };
  }

  private resolveUpdateTarget(): {
    platform: string;
    arch: string;
    variant: string;
  } | null {
    const platform = process.platform;
    const arch = process.arch;
    if (!SUPPORTED_UPDATE_PLATFORMS.has(platform) || !SUPPORTED_UPDATE_ARCHITECTURES.has(arch)) {
      return null;
    }
    return { platform, arch, variant: this.resolveBuildVariant() };
  }

  private readCachedManifest(key: string): CachedSignedManifest | null {
    const value = this.store.get<unknown>(key);
    if (
      !value ||
      typeof value !== 'object' ||
      typeof (value as CachedSignedManifest).etag !== 'string' ||
      !(value as CachedSignedManifest).etag ||
      !('envelope' in value)
    ) {
      return null;
    }
    return value as CachedSignedManifest;
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
      crypto.createPublicKey({
        key: Buffer.from(trustedKey, 'base64'),
        format: 'der',
        type: 'spki',
      }),
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
    const expectedExtension =
      target.platform === 'darwin'
        ? '.dmg'
        : target.platform === 'linux'
          ? target.variant === 'appimage'
            ? '.appimage'
            : '.deb'
          : '.exe';
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
      url: downloadUrl.toString(),
      expectedSize: artifact.size,
      expectedSha256: artifact.sha256,
      mandatory: payload.mandatory === true,
      minimumSupportedVersion,
    };
  }

  private resolveBuildVariant(): string {
    if (process.platform === 'linux') {
      return process.env.APPIMAGE ? 'appimage' : 'deb';
    }
    if (process.platform !== 'win32') return 'default';
    try {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'),
      ) as { zhiyuanUpdateVariant?: unknown };
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
    return Boolean(
      info?.mandatory &&
      info.minimumSupportedVersion &&
      lt(this.resolveCurrentVersion(), info.minimumSupportedVersion),
    );
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
