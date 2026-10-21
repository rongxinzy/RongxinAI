import { app, BrowserWindow, shell } from 'electron';
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
  type AppUpdateChannelPreference,
  AppUpdateFailureStage,
  type AppUpdateInfo,
  AppUpdateInstallOutcome,
  AppUpdateIpc,
  type AppUpdateRuntimeState,
  AppUpdateSource,
  AppUpdateStatus,
} from '../../shared/appUpdate/constants';
import { AppQuitOrigin, recordAppQuitOrigin } from '../appQuitOrigin';
import type { SqliteStore } from '../sqliteStore';
import { isElectronUpdaterEnabled, resolveBuildVariant } from './appUpdateBuildFlavor';
import { installWindowsNsis } from './appUpdateInstaller';
import { sha512UpdateFile } from './appUpdateFileHasher';
import {
  DownloadProgressTracker,
  hideWindowsForInstall,
  isReadyUpdateStale,
  restoreHiddenWindows,
  verifyReadyUpdateFile,
  type VerifiedUpdateFile,
} from './appUpdateInstallSupport';
import { readInstallResult } from './appUpdateInstallReceipt';
import { AppUpdateReleaseChannel, toUpdateInfo, type UpdateTarget } from './appUpdateManifest';
import {
  electronUpdaterFeedUrl,
  manifestCacheKeyForChannel,
  readChannelPreference,
  writeChannelPreference,
} from './appUpdateChannelPreference';
import {
  readReadyUpdateCache,
  type ReadyUpdateCache,
  type RestoredReadyUpdate,
} from './appUpdateReadyCache';
import { verifyAndDecodeUpdateManifest } from './appUpdateSignedManifest';

const UPDATE_ENDPOINT = 'https://updates.rongxzyai.com/v1/updates/latest';
const READY_UPDATE_CACHE_KEY = 'app_update_ready_v2';
const SUPPORTED_UPDATE_PLATFORMS = new Set(['win32', 'darwin', 'linux']);
const SUPPORTED_UPDATE_ARCHITECTURES = new Set(['x64', 'arm64']);

type CachedSignedManifest = {
  etag: string;
  envelope: unknown;
};

type PendingReadyUpdate = ReadyUpdateCache & {
  info: AppUpdateInfo;
  source: AppUpdateSource;
};

type VerifiedUpdate = {
  envelope: unknown;
  info: AppUpdateInfo;
  target: UpdateTarget;
};

type AppUpdateInstallResult = {
  success: boolean;
  state: AppUpdateRuntimeState;
  error?: string;
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

export interface AppUpdateCoordinatorOptions {
  /**
   * Enterprise builds receive updates through the enterprise distribution
   * channel, so the client never configures a feed, checks for, downloads, or
   * installs online updates.
   */
  readonly enterpriseBuild?: boolean;
}

const ENTERPRISE_BUILD_UPDATE_DISABLED_MESSAGE =
  'This enterprise build does not provide online updates';

const initialState = (): AppUpdateRuntimeState => ({
  status: AppUpdateStatus.Idle,
  source: null,
  info: null,
  progress: null,
  lastCheckedAt: null,
  readyFilePath: null,
  readyFileHash: null,
  errorMessage: null,
  failureStage: null,
  lastInstallResult: null,
});

/**
 * Authorizes electron-updater with the existing signed v1 manifest before it
 * reads any v2 metadata. The legacy manifest remains the trust root during the
 * protocol migration; electron-updater provides download, cache and install.
 */
export class AppUpdateCoordinator {
  private state: AppUpdateRuntimeState = initialState();
  private readonly store: SqliteStore;
  private readonly updater: ElectronUpdaterAdapter;
  private readonly openExternal: (url: string) => Promise<unknown>;
  private readonly enterpriseBuild: boolean;
  private checkPromise: Promise<AppUpdateCheckResult> | null = null;
  private downloadPromise: Promise<void> | null = null;
  private installPromise: Promise<AppUpdateInstallResult> | null = null;
  private downloadCancellation: CancellationToken | null = null;
  private currentSignedEnvelope: unknown | null = null;
  private downloadedFilePath: string | null = null;
  private pendingReadyUpdate: PendingReadyUpdate | null = null;
  private readyFreshnessPromise: Promise<VerifiedUpdate | null> | null = null;
  private verifiedFile: VerifiedUpdateFile | null = null;
  private hiddenWindowsForInstall: BrowserWindow[] = [];
  private readonly downloadProgress = new DownloadProgressTracker();
  private pendingInstallResultTimer: NodeJS.Timeout | null = null;
  private readonly onDownloadProgress = (progress: ProgressInfo): void =>
    this.handleDownloadProgress(progress);
  private readonly onUpdateDownloaded = (event: { downloadedFile: string }): void => {
    this.downloadedFilePath = event.downloadedFile;
    // The cache directory is not obvious from the UI; log the concrete path
    // so support can locate the payload from logs.
    console.info(`[AppUpdate] update payload cached at: ${event.downloadedFile}`);
  };
  private readonly onUpdaterError = (error: Error): void => this.handleUpdaterError(error);

  constructor(
    store: SqliteStore,
    updater: ElectronUpdaterAdapter = autoUpdater,
    openExternal: (url: string) => Promise<unknown> = url => shell.openExternal(url),
    options: AppUpdateCoordinatorOptions = {},
  ) {
    this.store = store;
    this.updater = updater;
    this.openExternal = openExternal;
    this.enterpriseBuild = options.enterpriseBuild === true;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.on('download-progress', this.onDownloadProgress);
    this.updater.on('update-downloaded', this.onUpdateDownloaded);
    this.updater.on('error', this.onUpdaterError);
    this.state.lastInstallResult = readInstallResult(app.getVersion());
    if (this.state.lastInstallResult?.outcome === AppUpdateInstallOutcome.Pending) {
      const delay = Math.max(0, this.state.lastInstallResult.recordedAt + 5 * 60_000 - Date.now());
      this.pendingInstallResultTimer = setTimeout(() => {
        this.pendingInstallResultTimer = null;
        const result = readInstallResult(app.getVersion());
        if (result?.outcome === AppUpdateInstallOutcome.Failed) {
          this.setState({ ...this.state, lastInstallResult: result });
        }
      }, delay + 1);
      this.pendingInstallResultTimer.unref();
    }
    this.restoreReadyUpdate();
    if (this.pendingReadyUpdate) {
      void this.recheckPendingReadyUpdate().then(update => this.startSupersedingUpdate(update));
    }
  }

  /** Release global autoUpdater listeners when a coordinator is replaced in tests or embedding code. */
  dispose(): void {
    if (this.pendingInstallResultTimer) clearTimeout(this.pendingInstallResultTimer);
    this.updater.removeListener('download-progress', this.onDownloadProgress);
    this.updater.removeListener('update-downloaded', this.onUpdateDownloaded);
    this.updater.removeListener('error', this.onUpdaterError);
  }

  getState(): AppUpdateRuntimeState {
    this.clearStateIfUpdatesDisabled();
    return { ...this.state };
  }

  async checkNow(options: { manual?: boolean } = {}): Promise<AppUpdateCheckResult> {
    if (this.clearStateIfUpdatesDisabled()) {
      if (this.enterpriseBuild && options.manual) {
        return {
          success: false,
          state: { ...this.state },
          updateFound: false,
          error: ENTERPRISE_BUILD_UPDATE_DISABLED_MESSAGE,
        };
      }
      return { success: true, state: { ...this.state }, updateFound: false };
    }
    if (this.readyFreshnessPromise) {
      await this.readyFreshnessPromise;
      const state = this.getState();
      return {
        success: state.status !== AppUpdateStatus.Error,
        state,
        updateFound: state.info !== null,
        ...(state.status === AppUpdateStatus.Error && state.errorMessage
          ? { error: state.errorMessage }
          : {}),
      };
    }
    if (this.checkPromise) return this.checkPromise;
    // Do not let the periodic checker replace an active download or a running
    // verification. Apart from hiding About-page progress, changing the state
    // makes the completion guard discard an otherwise valid download.
    if (
      this.downloadPromise &&
      (this.state.status === AppUpdateStatus.Downloading ||
        this.state.status === AppUpdateStatus.Verifying)
    ) {
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
    if (this.clearStateIfUpdatesDisabled()) return { ...this.state };
    if (
      this.state.failureStage === AppUpdateFailureStage.Check ||
      (this.state.status === AppUpdateStatus.Error && !this.state.info)
    ) {
      return (await this.checkNow({ manual: true })).state;
    }
    if (this.pendingReadyUpdate) {
      const update = await this.recheckPendingReadyUpdate();
      this.startSupersedingUpdate(update);
      return this.getState();
    }
    if (
      this.state.failureStage === AppUpdateFailureStage.Install &&
      this.state.readyFilePath &&
      this.state.readyFileHash
    ) {
      const existingFile = await fs.promises.stat(this.state.readyFilePath).catch((): null => null);
      if (existingFile?.isFile() && existingFile.size > 0) {
        return this.setState({
          ...this.state,
          status: AppUpdateStatus.Ready,
          errorMessage: null,
          failureStage: null,
        });
      }
    }
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
    if (info.manualDownloadOnly) {
      try {
        await this.openExternal(info.url);
        return this.getState();
      } catch (error) {
        return this.setState({
          ...this.state,
          status: AppUpdateStatus.Error,
          errorMessage:
            error instanceof Error ? error.message : 'Unable to open the update download page',
          failureStage: AppUpdateFailureStage.Download,
        });
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
      this.verifiedFile = null;
      this.downloadProgress.reset();
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

  async installReadyUpdate(): Promise<AppUpdateInstallResult> {
    if (this.clearStateIfUpdatesDisabled()) {
      return {
        success: false,
        state: { ...this.state },
        error: this.updateDisabledMessage(),
      };
    }
    // One install at a time: a second click while the handoff is being
    // prepared must not spawn a second installer.
    if (this.installPromise) return this.installPromise;
    const promise = this.performInstallReadyUpdate();
    this.installPromise = promise;
    void promise
      .catch((): undefined => undefined)
      .finally(() => {
        if (this.installPromise === promise) this.installPromise = null;
      });
    return promise;
  }

  private async performInstallReadyUpdate(): Promise<AppUpdateInstallResult> {
    const { info, readyFileHash, readyFilePath } = this.state;
    if (this.state.status !== AppUpdateStatus.Ready || !info || !readyFileHash || !readyFilePath) {
      return { success: false, state: this.getState(), error: 'No verified update is ready' };
    }

    // Acknowledge the click before any blocking work: the renderer replaces the
    // install button with the installing status instead of leaving it looking
    // dead while the file is verified.
    this.state.lastInstallResult = null;
    this.setState({
      ...this.state,
      status: AppUpdateStatus.Installing,
      progress: null,
      errorMessage: null,
    });

    try {
      // A ready state that has aged past the freshness window may have been
      // superseded. The check is skipped for the common case (click within
      // minutes of the download) so the click no longer blocks on the network.
      if (isReadyUpdateStale(this.state.lastCheckedAt)) {
        let newer: VerifiedUpdate | null = null;
        try {
          const ready = this.state.info;
          const latest = await this.fetchUpdateInfo(this.resolveCurrentVersion());
          newer = ready && latest && !this.isSameUpdate(ready, latest.info) ? latest : null;
          if (newer) await this.assertElectronUpdaterFeed(newer);
        } catch (error) {
          throw new Error(
            `Unable to confirm the latest update: ${
              error instanceof Error ? error.message : 'update check failed'
            }`,
          );
        }
        if (newer) {
          const source = this.state.source ?? AppUpdateSource.Manual;
          this.currentSignedEnvelope = newer.envelope;
          this.setState({
            ...initialState(),
            status: AppUpdateStatus.Available,
            source,
            info: newer.info,
            lastCheckedAt: Date.now(),
          });
          this.startBackgroundDownload(newer, source);
          return {
            success: false,
            state: this.getState(),
            error: 'A newer update is available and must be downloaded before installation',
          };
        }
      }

      this.verifiedFile = await verifyReadyUpdateFile(
        readyFilePath,
        info,
        readyFileHash,
        this.verifiedFile,
      );
      this.hiddenWindowsForInstall = hideWindowsForInstall();
      if (process.platform === 'win32') {
        await installWindowsNsis(readyFilePath, info.latestVersion);
      } else {
        recordAppQuitOrigin(AppQuitOrigin.UpdateInstall);
        this.updater.quitAndInstall(false, true);
      }
      return { success: true, state: this.getState() };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update installation failed';
      restoreHiddenWindows(this.hiddenWindowsForInstall);
      this.hiddenWindowsForInstall = [];
      const state = this.setState({
        ...this.state,
        status: AppUpdateStatus.Error,
        errorMessage: message,
        failureStage: AppUpdateFailureStage.Install,
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
      if (update.info.manualDownloadOnly) {
        const state = this.setState({
          ...initialState(),
          status: AppUpdateStatus.Available,
          source,
          info: update.info,
          lastCheckedAt: Date.now(),
        });
        return { success: true, state, updateFound: true };
      }
      await this.assertElectronUpdaterFeed(update);

      if (
        previousReady?.info &&
        this.isSameUpdate(previousReady.info, update.info) &&
        previousReady.readyFileHash === update.info.expectedUpdaterSha512 &&
        previousReady.readyFilePath
      ) {
        this.currentSignedEnvelope = update.envelope;
        return { success: true, state: this.setState(previousReady), updateFound: true };
      }

      this.setState({
        ...initialState(),
        status: AppUpdateStatus.Available,
        source,
        info: update.info,
        lastCheckedAt: Date.now(),
      });
      this.startBackgroundDownload(update, source);
      return { success: true, state: this.getState(), updateFound: true };
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
          failureStage: AppUpdateFailureStage.Check,
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
    this.verifiedFile = null;
    this.downloadProgress.reset();
    this.setState({
      ...initialState(),
      status: AppUpdateStatus.Downloading,
      source,
      info,
      lastCheckedAt: this.state.lastCheckedAt,
    });
    let supersedingUpdate: VerifiedUpdate | null = null;
    this.downloadPromise = this.updater
      .downloadUpdate(cancellation)
      .then(async filePaths => {
        const downloadedFile = this.downloadedFilePath ?? filePaths[0];
        if (!downloadedFile) throw new Error('electron-updater did not return an update file');
        // The bytes are on disk now; the checksum and the manifest freshness
        // check still have to run. Say so instead of leaving the progress bar
        // frozen at its last transfer percentage.
        if (
          cancellation.cancelled ||
          this.state.status !== AppUpdateStatus.Downloading ||
          this.state.info?.latestVersion !== info.latestVersion
        ) {
          return;
        }
        this.setState({
          ...initialState(),
          status: AppUpdateStatus.Verifying,
          source,
          info,
          lastCheckedAt: this.state.lastCheckedAt,
        });
        const beforeHash = await fs.promises.stat(downloadedFile);
        const sha512 = await sha512UpdateFile(downloadedFile);
        if (
          cancellation.cancelled ||
          this.currentStatus() !== AppUpdateStatus.Verifying ||
          this.state.info?.latestVersion !== info.latestVersion
        ) {
          return;
        }
        if (sha512 !== info.expectedUpdaterSha512) {
          throw new Error('electron-updater file checksum does not match the signed manifest');
        }
        // Record the identity of the bytes that were hashed, and only if the
        // file did not change while it was being read. Installation reuses this
        // identity to skip a third full read; any mismatch re-hashes instead.
        const afterHash = await fs.promises.stat(downloadedFile);
        if (beforeHash.size !== afterHash.size || beforeHash.mtimeMs !== afterHash.mtimeMs) {
          throw new Error('Update file changed while its checksum was being verified');
        }
        this.verifiedFile = {
          filePath: downloadedFile,
          size: afterHash.size,
          mtimeMs: afterHash.mtimeMs,
        };
        const readyUpdate: ReadyUpdateCache = {
          envelope,
          filePath: downloadedFile,
          sha512,
        };
        this.pendingReadyUpdate = { ...readyUpdate, info, source };
        this.setState({
          ...initialState(),
          status: AppUpdateStatus.Checking,
          source,
          info,
          lastCheckedAt: this.state.lastCheckedAt,
        });
        supersedingUpdate = await this.recheckPendingReadyUpdate();
      })
      .catch(error => {
        // cancelDownload already restored Available. Cancellation is not an error.
        if (
          (this.state.status !== AppUpdateStatus.Downloading &&
            this.state.status !== AppUpdateStatus.Verifying) ||
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
          failureStage:
            this.state.status === AppUpdateStatus.Verifying
              ? AppUpdateFailureStage.Verify
              : AppUpdateFailureStage.Download,
        });
      })
      .finally(() => {
        if (this.downloadCancellation === cancellation) this.downloadCancellation = null;
        this.downloadPromise = null;
        this.startSupersedingUpdate(supersedingUpdate);
      });
  }

  private recheckPendingReadyUpdate(): Promise<VerifiedUpdate | null> {
    if (this.readyFreshnessPromise) return this.readyFreshnessPromise;
    this.readyFreshnessPromise = this.performPendingReadyRecheck().finally(() => {
      this.readyFreshnessPromise = null;
    });
    return this.readyFreshnessPromise;
  }

  private async performPendingReadyRecheck(): Promise<VerifiedUpdate | null> {
    const pending = this.pendingReadyUpdate;
    if (!pending) return null;
    this.setState({
      ...initialState(),
      status: AppUpdateStatus.Checking,
      source: pending.source,
      info: pending.info,
      lastCheckedAt: this.state.lastCheckedAt,
    });
    try {
      const latest = await this.fetchUpdateInfo(this.resolveCurrentVersion());
      if (this.pendingReadyUpdate !== pending) return null;
      if (!latest) {
        this.pendingReadyUpdate = null;
        this.currentSignedEnvelope = null;
        this.store.delete(READY_UPDATE_CACHE_KEY);
        this.setState({
          ...initialState(),
          status: AppUpdateStatus.UpToDate,
          lastCheckedAt: Date.now(),
        });
        return null;
      }
      await this.assertElectronUpdaterFeed(latest);
      if (this.isSameUpdate(pending.info, latest.info)) {
        const readyUpdate: ReadyUpdateCache = {
          envelope: latest.envelope,
          filePath: pending.filePath,
          sha512: pending.sha512,
        };
        this.store.set<ReadyUpdateCache>(READY_UPDATE_CACHE_KEY, readyUpdate);
        this.pendingReadyUpdate = null;
        this.currentSignedEnvelope = latest.envelope;
        this.setState({
          ...initialState(),
          status: AppUpdateStatus.Ready,
          source: pending.source,
          info: latest.info,
          lastCheckedAt: Date.now(),
          readyFilePath: pending.filePath,
          readyFileHash: pending.sha512,
        });
        return null;
      }

      this.pendingReadyUpdate = null;
      this.currentSignedEnvelope = latest.envelope;
      this.store.delete(READY_UPDATE_CACHE_KEY);
      this.setState({
        ...initialState(),
        status: AppUpdateStatus.Available,
        source: pending.source,
        info: latest.info,
        lastCheckedAt: Date.now(),
      });
      return latest;
    } catch (error) {
      if (this.pendingReadyUpdate === pending) {
        const message = error instanceof Error ? error.message : 'Update freshness check failed';
        console.warn('[AppUpdate] ready update freshness check failed:', message);
        this.setState({
          ...initialState(),
          status: AppUpdateStatus.Error,
          source: pending.source,
          info: pending.info,
          lastCheckedAt: this.state.lastCheckedAt,
          errorMessage: `Unable to confirm the latest update: ${message}`,
          failureStage: AppUpdateFailureStage.Verify,
        });
      }
      return null;
    }
  }

  private startSupersedingUpdate(update: VerifiedUpdate | null): void {
    if (!update || update.info.manualDownloadOnly) return;
    if (
      this.state.status !== AppUpdateStatus.Available ||
      this.state.info?.latestVersion !== update.info.latestVersion
    ) {
      return;
    }
    this.startBackgroundDownload(update, this.state.source ?? AppUpdateSource.Auto);
  }

  private isSameUpdate(left: AppUpdateInfo, right: AppUpdateInfo): boolean {
    return (
      left.latestVersion === right.latestVersion &&
      left.expectedUpdaterFileName === right.expectedUpdaterFileName &&
      left.expectedUpdaterSha512 === right.expectedUpdaterSha512 &&
      left.manualDownloadOnly === right.manualDownloadOnly
    );
  }

  private async assertElectronUpdaterFeed(update: VerifiedUpdate): Promise<void> {
    if (update.info.manualDownloadOnly) return;
    this.configureUpdater(update.target);
    const result = await this.updater.checkForUpdates();
    if (!result?.isUpdateAvailable) {
      throw new Error('The electron updater feed does not contain the signed update');
    }
    this.assertUpdaterMatchesSignedManifest(result.updateInfo, update.info);
  }

  /** Reads the status through a call so TypeScript does not keep a stale narrowing. */
  private currentStatus(): AppUpdateStatus {
    return this.state.status;
  }

  private handleDownloadProgress(progress: ProgressInfo): void {
    if (this.currentStatus() !== AppUpdateStatus.Downloading) return;
    this.setState({ ...this.state, progress: this.downloadProgress.observe(progress) });
  }

  private handleUpdaterError(error: Error): void {
    if (this.state.status !== AppUpdateStatus.Downloading) return;
    this.setState({
      ...this.state,
      status: AppUpdateStatus.Error,
      progress: null,
      errorMessage: error.message || 'electron-updater failed',
      failureStage: AppUpdateFailureStage.Download,
    });
  }

  getChannelPreference(): AppUpdateReleaseChannel {
    return readChannelPreference(this.store);
  }

  setChannelPreference(channel: AppUpdateChannelPreference): void {
    writeChannelPreference(this.store, channel);
    this.clearTransientUpdateState();
  }

  private resolveReleaseChannel(): AppUpdateReleaseChannel {
    return readChannelPreference(this.store);
  }

  private manifestCacheKey(target: UpdateTarget): string {
    return manifestCacheKeyForChannel(this.resolveReleaseChannel(), target);
  }

  private configureUpdater(target: UpdateTarget): void {
    this.updater.setFeedURL({
      provider: 'generic',
      url: electronUpdaterFeedUrl(this.resolveReleaseChannel(), target),
    });
  }

  private clearTransientUpdateState(): void {
    this.downloadCancellation?.cancel();
    this.downloadCancellation = null;
    this.currentSignedEnvelope = null;
    this.downloadedFilePath = null;
    this.pendingReadyUpdate = null;
    this.verifiedFile = null;
    this.setState(initialState());
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
    this.verifiedFile = null;
    if (this.isUpdateDisabled()) {
      this.store.delete(READY_UPDATE_CACHE_KEY);
      return;
    }
    // Windows owns the final installer handoff directly. macOS and Linux let
    // electron-updater manage their internal cache, which is not a stable API
    // we should reconstruct after restart.
    if (process.platform !== 'win32') {
      this.store.delete(READY_UPDATE_CACHE_KEY);
      return;
    }
    let restored: RestoredReadyUpdate | null = null;
    try {
      restored = readReadyUpdateCache({
        cached: this.store.get<unknown>(READY_UPDATE_CACHE_KEY),
        target: this.resolveUpdateTarget(),
        channel: this.resolveReleaseChannel(),
        currentVersion: this.resolveCurrentVersion(),
      });
    } catch {
      restored = null;
    }
    if (!restored) {
      this.store.delete(READY_UPDATE_CACHE_KEY);
      return;
    }
    this.currentSignedEnvelope = restored.envelope;
    this.downloadedFilePath = restored.filePath;
    this.pendingReadyUpdate = { ...restored, source: AppUpdateSource.Auto };
    this.state = {
      ...initialState(),
      status: AppUpdateStatus.Checking,
      source: AppUpdateSource.Auto,
      info: restored.info,
    };
  }

  private async fetchUpdateInfo(currentVersion: string): Promise<VerifiedUpdate | null> {
    const target = this.resolveUpdateTarget();
    if (!target) return null;
    const { platform, arch, variant } = target;
    const channel = this.resolveReleaseChannel();
    const cacheKey = this.manifestCacheKey(target);
    const cachedManifest = this.readCachedManifest(cacheKey);
    const url = new URL(UPDATE_ENDPOINT);
    url.searchParams.set('channel', channel);
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
    const payload = verifyAndDecodeUpdateManifest(envelope);
    const info = toUpdateInfo(payload, target, isElectronUpdaterEnabled(target.platform), channel);
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
    return { platform, arch, variant: resolveBuildVariant() };
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

  private isUpdateDisabled(): boolean {
    return (
      this.enterpriseBuild ||
      this.store.get<{ disableUpdate?: boolean }>('enterprise_config')?.disableUpdate === true
    );
  }

  private updateDisabledMessage(): string {
    return this.enterpriseBuild
      ? ENTERPRISE_BUILD_UPDATE_DISABLED_MESSAGE
      : 'Updates are disabled by enterprise policy';
  }

  private clearStateIfUpdatesDisabled(): boolean {
    if (!this.isUpdateDisabled()) return false;
    this.downloadCancellation?.cancel();
    this.downloadCancellation = null;
    this.currentSignedEnvelope = null;
    this.downloadedFilePath = null;
    this.pendingReadyUpdate = null;
    this.verifiedFile = null;
    this.store.delete(READY_UPDATE_CACHE_KEY);
    if (this.state.status !== AppUpdateStatus.Idle || this.state.info !== null) {
      this.setState(initialState());
    }
    return true;
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
    this.state = {
      ...nextState,
      lastInstallResult: nextState.lastInstallResult ?? this.state.lastInstallResult,
    };
    const snapshot = this.getState();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(AppUpdateIpc.StateChanged, snapshot);
    }
    return snapshot;
  }
}
