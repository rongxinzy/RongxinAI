import crypto from 'crypto';
import { app, BrowserWindow } from 'electron';
import {
  autoUpdater,
  CancellationToken,
  type ProgressInfo,
  type UpdateInfo,
} from 'electron-updater';
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
import { installWindowsNsis } from './appUpdateInstaller';

const UPDATE_ENDPOINT = 'https://updates.rongxzyai.com/v1/updates/latest';
const ELECTRON_UPDATE_FEED_BASE = 'https://updates.rongxzyai.com/v2/electron';
const DOWNLOAD_HOST = 'downloads.rongxzyai.com';
const MANIFEST_CACHE_KEY_PREFIX = 'app_update_manifest_cache';
const READY_UPDATE_CACHE_KEY = 'app_update_ready_v2';
const SUPPORTED_UPDATE_PLATFORMS = new Set(['win32', 'darwin', 'linux']);
const SUPPORTED_UPDATE_ARCHITECTURES = new Set(['x64', 'arm64']);

type UpdateTarget = {
  platform: string;
  arch: string;
  variant: string;
};

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
    updater?: {
      sha512?: unknown;
      size?: unknown;
      filename?: unknown;
    };
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
  sha512: string;
};

type VerifiedUpdate = {
  envelope: unknown;
  info: AppUpdateInfo;
  target: UpdateTarget;
};

type ElectronUpdaterAdapter = Pick<
  typeof autoUpdater,
  | 'autoDownload'
  | 'autoInstallOnAppQuit'
  | 'on'
  | 'removeListener'
  | 'setFeedURL'
  | 'checkForUpdates'
  | 'downloadUpdate'
  | 'quitAndInstall'
>;

const initialState = (): AppUpdateRuntimeState => ({
  status: AppUpdateStatus.Idle,
  source: null,
  info: null,
  progress: null,
  lastCheckedAt: null,
  readyFilePath: null,
  readyFileHash: null,
  errorMessage: null,
});

function base64UrlToBuffer(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url value');
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function isSha512(value: unknown): value is string {
  // A SHA-512 digest is 86 base64 characters, optionally followed by "==".
  return typeof value === 'string' && /^[A-Za-z0-9+/]{86}(?:==)?$/.test(value);
}

/**
 * Authorizes electron-updater with the existing signed v1 manifest before it
 * reads any v2 metadata. The legacy manifest remains the trust root during the
 * protocol migration; electron-updater provides download, cache and install.
 */
export class AppUpdateCoordinator {
  private state: AppUpdateRuntimeState = initialState();
  private readonly store: SqliteStore;
  private readonly updater: ElectronUpdaterAdapter;
  private checkPromise: Promise<AppUpdateCheckResult> | null = null;
  private downloadPromise: Promise<void> | null = null;
  private downloadCancellation: CancellationToken | null = null;
  private currentSignedEnvelope: unknown | null = null;
  private downloadedFilePath: string | null = null;
  private readonly onDownloadProgress = (progress: ProgressInfo): void =>
    this.handleDownloadProgress(progress);
  private readonly onUpdateDownloaded = (event: { downloadedFile: string }): void => {
    this.downloadedFilePath = event.downloadedFile;
  };
  private readonly onUpdaterError = (error: Error): void => this.handleUpdaterError(error);

  constructor(store: SqliteStore, updater: ElectronUpdaterAdapter = autoUpdater) {
    this.store = store;
    this.updater = updater;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.on('download-progress', this.onDownloadProgress);
    this.updater.on('update-downloaded', this.onUpdateDownloaded);
    this.updater.on('error', this.onUpdaterError);
    this.restoreReadyUpdate();
  }

  /** Release global autoUpdater listeners when a coordinator is replaced in tests or embedding code. */
  dispose(): void {
    this.updater.removeListener('download-progress', this.onDownloadProgress);
    this.updater.removeListener('update-downloaded', this.onUpdateDownloaded);
    this.updater.removeListener('error', this.onUpdaterError);
  }

  getState(): AppUpdateRuntimeState {
    return { ...this.state };
  }

  async checkNow(options: { manual?: boolean } = {}): Promise<AppUpdateCheckResult> {
    if (this.isUpdateDisabled()) {
      this.currentSignedEnvelope = null;
      return { success: true, state: this.setState(initialState()), updateFound: false };
    }
    if (this.checkPromise) return this.checkPromise;
    // Do not let the periodic checker replace an active download state. Apart
    // from hiding About-page progress, changing the state makes the completion
    // guard discard an otherwise valid download.
    if (this.downloadPromise && this.state.status === AppUpdateStatus.Downloading) {
      return {
        success: true,
        state: this.getState(),
        updateFound: this.state.info !== null,
      };
    }

    const source = options.manual ? AppUpdateSource.Manual : AppUpdateSource.Auto;
    this.checkPromise = this.checkForUpdate(source).finally(() => {
      this.checkPromise = null;
    });
    return this.checkPromise;
  }

  async retryDownload(): Promise<AppUpdateRuntimeState> {
    const info = this.state.info;
    const target = this.resolveUpdateTarget();
    if (!info || !target || this.state.status === AppUpdateStatus.Installing) {
      return this.getState();
    }
    // Cancellation is asynchronous in electron-updater. If the user retries
    // immediately, wait for the cancelled promise to drain instead of making
    // the first retry click appear to do nothing.
    if (this.downloadPromise) {
      await this.downloadPromise;
      const currentState = this.getState();
      if (
        currentState.info?.latestVersion !== info.latestVersion ||
        currentState.status === AppUpdateStatus.Downloading ||
        currentState.status === AppUpdateStatus.Ready ||
        currentState.status === AppUpdateStatus.Installing
      ) {
        return currentState;
      }
    }
    if (!this.currentSignedEnvelope) {
      void this.checkNow({ manual: true });
      return this.getState();
    }
    this.startBackgroundDownload(
      { info, target, envelope: this.currentSignedEnvelope },
      this.state.source ?? AppUpdateSource.Manual,
    );
    return this.getState();
  }

  cancelDownload(): AppUpdateRuntimeState {
    if (this.state.status === AppUpdateStatus.Downloading && this.downloadCancellation) {
      this.downloadCancellation.cancel();
      this.downloadCancellation = null;
      this.downloadedFilePath = null;
      this.setState({
        ...initialState(),
        status: AppUpdateStatus.Available,
        source: this.state.source,
        info: this.state.info,
        lastCheckedAt: this.state.lastCheckedAt,
      });
    }
    return this.getState();
  }

  // electron-updater has no public pause/resume API. Keep IPC compatibility,
  // but never claim a paused or resumable transfer to the renderer.
  pauseDownload(): AppUpdateRuntimeState {
    return this.getState();
  }

  resumeDownload(): AppUpdateRuntimeState {
    return this.getState();
  }

  async installReadyUpdate(): Promise<{
    success: boolean;
    state: AppUpdateRuntimeState;
    error?: string;
  }> {
    const { info, readyFileHash, readyFilePath } = this.state;
    if (this.state.status !== AppUpdateStatus.Ready || !info || !readyFileHash || !readyFilePath) {
      return { success: false, state: this.getState(), error: 'No verified update is ready' };
    }

    try {
      const stat = await fs.promises.stat(readyFilePath);
      if (!stat.isFile() || stat.size === 0) {
        throw new Error('Downloaded update file is no longer valid');
      }
      if (path.basename(readyFilePath) !== info.expectedUpdaterFileName) {
        throw new Error('Downloaded update filename no longer matches the signed manifest');
      }
      const actualSha512 = await this.sha512File(readyFilePath);
      if (actualSha512 !== readyFileHash || actualSha512 !== info.expectedUpdaterSha512) {
        throw new Error('Downloaded update checksum verification failed');
      }
      this.setState({
        ...this.state,
        status: AppUpdateStatus.Installing,
        progress: null,
        errorMessage: null,
      });
      if (process.platform === 'win32') {
        await installWindowsNsis(readyFilePath);
      } else {
        this.updater.quitAndInstall(false, true);
      }
      return { success: true, state: this.getState() };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update installation failed';
      const state = this.setState({
        ...this.state,
        status: AppUpdateStatus.Error,
        errorMessage: message,
      });
      return { success: false, state, error: message };
    }
  }

  private async checkForUpdate(source: AppUpdateSource): Promise<AppUpdateCheckResult> {
    const previousState = this.getState();
    const previousReady = this.state.status === AppUpdateStatus.Ready ? this.getState() : null;
    const previousEnvelope = this.currentSignedEnvelope;
    this.setState({
      ...initialState(),
      status: AppUpdateStatus.Checking,
      source,
      lastCheckedAt: previousState.lastCheckedAt,
    });
    try {
      const currentVersion = this.resolveCurrentVersion();
      const update = await this.fetchUpdateInfo(currentVersion);
      if (!update) {
        this.currentSignedEnvelope = null;
        this.store.delete(READY_UPDATE_CACHE_KEY);
        const state = this.setState({
          ...initialState(),
          status: AppUpdateStatus.UpToDate,
          lastCheckedAt: Date.now(),
        });
        return { success: true, state, updateFound: false };
      }

      this.currentSignedEnvelope = update.envelope;
      this.configureUpdater(update.target);
      const result = await this.updater.checkForUpdates();
      if (!result?.isUpdateAvailable) {
        throw new Error('The electron updater feed does not contain the signed update');
      }
      this.assertUpdaterMatchesSignedManifest(result.updateInfo, update.info);

      if (
        previousReady?.info?.latestVersion === update.info.latestVersion &&
        previousReady.readyFileHash === update.info.expectedUpdaterSha512 &&
        previousReady.readyFilePath
      ) {
        this.currentSignedEnvelope = update.envelope;
        return { success: true, state: this.setState(previousReady), updateFound: true };
      }

      const state = this.setState({
        ...initialState(),
        status: AppUpdateStatus.Available,
        source,
        info: update.info,
        lastCheckedAt: Date.now(),
      });
      this.startBackgroundDownload(update, source);
      return { success: true, state, updateFound: true };
    } catch (error) {
      console.warn(
        '[AppUpdate] update check failed:',
        error instanceof Error ? error.message : 'unknown',
      );
      if (previousReady) this.currentSignedEnvelope = previousEnvelope;
      const state = this.setState(
        previousReady ?? {
          ...initialState(),
          status: AppUpdateStatus.Error,
          source,
          lastCheckedAt: previousState.lastCheckedAt,
          errorMessage: error instanceof Error ? error.message : 'Update check failed',
        },
      );
      return {
        success: false,
        state,
        updateFound: false,
        error: error instanceof Error ? error.message : 'Update check failed',
      };
    }
  }

  private startBackgroundDownload(update: VerifiedUpdate, source: AppUpdateSource): void {
    if (this.downloadPromise) return;
    const { envelope, info } = update;
    const cancellation = new CancellationToken();
    this.downloadCancellation = cancellation;
    this.downloadedFilePath = null;
    this.setState({
      ...initialState(),
      status: AppUpdateStatus.Downloading,
      source,
      info,
      lastCheckedAt: this.state.lastCheckedAt,
    });
    this.downloadPromise = this.updater
      .downloadUpdate(cancellation)
      .then(async filePaths => {
        const downloadedFile = this.downloadedFilePath ?? filePaths[0];
        if (!downloadedFile) throw new Error('electron-updater did not return an update file');
        const sha512 = await this.sha512File(downloadedFile);
        if (
          cancellation.cancelled ||
          this.state.status !== AppUpdateStatus.Downloading ||
          this.state.info?.latestVersion !== info.latestVersion
        ) {
          return;
        }
        if (sha512 !== info.expectedUpdaterSha512) {
          throw new Error('electron-updater file checksum does not match the signed manifest');
        }
        const readyUpdate: ReadyUpdateCache = {
          envelope,
          filePath: downloadedFile,
          sha512,
        };
        this.store.set<ReadyUpdateCache>(READY_UPDATE_CACHE_KEY, readyUpdate);
        this.currentSignedEnvelope = envelope;
        this.setState({
          ...initialState(),
          status: AppUpdateStatus.Ready,
          source,
          info,
          readyFilePath: downloadedFile,
          readyFileHash: sha512,
        });
      })
      .catch(error => {
        // cancelDownload already restored Available. Cancellation is not an error.
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
        if (this.downloadCancellation === cancellation) this.downloadCancellation = null;
        this.downloadPromise = null;
      });
  }

  private handleDownloadProgress(progress: ProgressInfo): void {
    if (this.state.status !== AppUpdateStatus.Downloading) return;
    const total = progress.total > 0 ? progress.total : undefined;
    this.setState({
      ...this.state,
      progress: {
        received: progress.transferred,
        total,
        percent: total ? progress.transferred / total : undefined,
        speed: progress.bytesPerSecond > 0 ? progress.bytesPerSecond : undefined,
      },
    });
  }

  private handleUpdaterError(error: Error): void {
    if (this.state.status !== AppUpdateStatus.Downloading) return;
    this.setState({
      ...this.state,
      status: AppUpdateStatus.Error,
      progress: null,
      errorMessage: error.message || 'electron-updater failed',
    });
  }

  private configureUpdater(target: UpdateTarget): void {
    const feedUrl = new URL(
      `${target.platform}/${target.arch}/${target.variant}/`,
      `${ELECTRON_UPDATE_FEED_BASE}/stable/`,
    );
    this.updater.setFeedURL({ provider: 'generic', url: feedUrl.toString() });
  }

  private assertUpdaterMatchesSignedManifest(updateInfo: UpdateInfo, info: AppUpdateInfo): void {
    if (updateInfo.version !== info.latestVersion) {
      throw new Error('electron-updater version does not match the signed manifest');
    }
    const expectedFile = updateInfo.files.find(file => {
      try {
        return (
          decodeURIComponent(
            path.basename(new URL(file.url, 'https://updates.rongxzyai.com/').pathname),
          ) === info.expectedUpdaterFileName
        );
      } catch {
        return false;
      }
    });
    if (!expectedFile || expectedFile.sha512 !== info.expectedUpdaterSha512) {
      throw new Error('electron-updater checksum does not match the signed manifest');
    }
  }

  private restoreReadyUpdate(): void {
    const cached = this.store.get<unknown>(READY_UPDATE_CACHE_KEY);
    if (!cached || typeof cached !== 'object') return;
    // Windows owns the final installer handoff directly. macOS and Linux let
    // electron-updater manage their internal cache, which is not a stable API
    // we should reconstruct after restart.
    if (process.platform !== 'win32') {
      this.store.delete(READY_UPDATE_CACHE_KEY);
      return;
    }
    try {
      const ready = cached as ReadyUpdateCache;
      if (
        typeof ready.filePath !== 'string' ||
        !isSha512(ready.sha512) ||
        !ready.envelope ||
        typeof ready.envelope !== 'object'
      ) {
        throw new Error('invalid ready update cache');
      }
      const target = this.resolveUpdateTarget();
      const info = target
        ? this.toUpdateInfo(this.verifyAndDecodeManifest(ready.envelope), target)
        : null;
      if (!info || ready.sha512 !== info.expectedUpdaterSha512)
        throw new Error('manifest mismatch');
      const resolvedFile = path.resolve(ready.filePath);
      if (path.basename(resolvedFile) !== info.expectedUpdaterFileName) {
        throw new Error('installer filename mismatch');
      }
      const stat = fs.statSync(resolvedFile);
      if (!stat.isFile() || stat.size === 0) {
        throw new Error('installer is missing or empty');
      }
      if (!this.isNewerVersion(info.latestVersion, this.resolveCurrentVersion())) {
        throw new Error('cached update is not newer than the running app');
      }
      this.currentSignedEnvelope = ready.envelope;
      this.downloadedFilePath = resolvedFile;
      this.state = {
        ...initialState(),
        status: AppUpdateStatus.Ready,
        source: AppUpdateSource.Auto,
        info,
        readyFilePath: resolvedFile,
        readyFileHash: ready.sha512,
      };
    } catch {
      this.store.delete(READY_UPDATE_CACHE_KEY);
    }
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
      if (receivedEtag)
        this.store.set<CachedSignedManifest>(cacheKey, { etag: receivedEtag, envelope });
      else this.store.delete(cacheKey);
    }
    if (!info || !this.isNewerVersion(info.latestVersion, currentVersion)) return null;
    return { envelope, info, target };
  }

  private resolveUpdateTarget(): UpdateTarget | null {
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

  private toUpdateInfo(payload: UpdatePayload, target: UpdateTarget): AppUpdateInfo | null {
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
      mandatory: payload.mandatory === true,
      minimumSupportedVersion,
    };
  }

  private resolveBuildVariant(): string {
    if (process.platform === 'linux') return process.env.APPIMAGE ? 'appimage' : 'deb';
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

  private async sha512File(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha512');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest('base64');
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
