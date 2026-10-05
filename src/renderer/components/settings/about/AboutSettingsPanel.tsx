import { Button } from '@shared/components/ui/button';
import { Progress } from '@shared/components/ui/progress';
import { useCallback, useEffect, useState } from 'react';

import {
  type AppUpdateRuntimeState,
  AppUpdateStatus,
} from '../../../../shared/appUpdate/constants';
import { normalizeError } from '../../../services/errorNormalization';
import { i18nService } from '../../../services/i18n';
import { useIsEnterpriseBuild } from '../useIsEnterpriseBuild';

const OFFICIAL_WEBSITE_URL = 'https://www.rongxzyai.com';

interface AboutSettingsPanelProps {
  appUpdateState?: AppUpdateRuntimeState;
  setError: (message: string | null) => void;
  setNoticeMessage: (message: string | null) => void;
}

export default function AboutSettingsPanel({
  appUpdateState,
  setError,
  setNoticeMessage,
}: AboutSettingsPanelProps) {
  const [appVersion, setAppVersion] = useState('');
  const [isDevBuild, setIsDevBuild] = useState(false);
  const isEnterpriseBuild = useIsEnterpriseBuild();
  const [isExportingLogs, setIsExportingLogs] = useState(false);

  useEffect(() => {
    void window.electron.appInfo.getVersion().then(setAppVersion);
    // Preload may lag behind Vite HMR after adding appInfo.isDev; never crash Settings on mount.
    const isDev = window.electron.appInfo.isDev;
    if (typeof isDev === 'function') {
      void isDev()
        .then(setIsDevBuild)
        .catch(() => setIsDevBuild(false));
    }
  }, []);

  const handleExportLogs = useCallback(async () => {
    if (isExportingLogs) {
      return;
    }

    setError(null);
    setNoticeMessage(null);
    setIsExportingLogs(true);
    try {
      const result = await window.electron.log.exportZip();
      if (!result.success) {
        setError(result.error || i18nService.t('aboutExportLogsFailed'));
        return;
      }
      if (result.canceled) {
        return;
      }

      if (result.path) {
        await window.electron.shell.showItemInFolder(result.path);
      }

      if ((result.missingEntries?.length ?? 0) > 0) {
        const missingList = result.missingEntries?.join(', ') || '';
        setNoticeMessage(`${i18nService.t('aboutExportLogsPartial')}: ${missingList}`);
      } else {
        setNoticeMessage(i18nService.t('aboutExportLogsSuccess'));
      }
    } catch (exportError) {
      setError(
        exportError instanceof Error ? exportError.message : i18nService.t('aboutExportLogsFailed'),
      );
    } finally {
      setIsExportingLogs(false);
    }
  }, [isExportingLogs, setError, setNoticeMessage]);

  const update = appUpdateState;
  const progress = update?.progress;
  const isDownloading = update?.status === AppUpdateStatus.Downloading;
  const formatBytes = (value: number) =>
    value < 1024 * 1024
      ? `${Math.round(value / 1024)} KB`
      : `${(value / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <div className="flex min-h-full flex-col items-center pt-6 pb-3">
      {/* Logo & App Name */}
      <img
        src="zhiyuan-logo-light.svg"
        alt="知远"
        className="logo-light h-16 w-auto mb-3 select-none"
      />
      <img
        src="zhiyuan-logo-dark.svg"
        alt="知远"
        className="logo-dark h-16 w-auto mb-3 select-none"
      />
      <span className="text-xs text-muted-foreground mt-1">v{appVersion}</span>
      <span className="text-xs text-muted-foreground mt-0.5">{i18nService.t('aboutTagline')}</span>

      {/* Info Card */}
      <div className="w-full mt-8 rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm text-foreground">{i18nService.t('aboutVersion')}</span>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{appVersion}</span>
          </div>
        </div>
        {!isEnterpriseBuild && (
          <>
            <div className="px-4 py-3 border-b border-border space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">
                  {i18nService.t('updateSectionTitle')}
                </span>
                <span className="text-sm text-muted-foreground">
                  {update?.status === AppUpdateStatus.Checking
                    ? i18nService.t('updateChecking')
                    : update?.status === AppUpdateStatus.UpToDate
                      ? i18nService.t('updateUpToDate')
                      : update?.status === AppUpdateStatus.Error
                        ? i18nService.t('updateCheckFailed')
                        : update?.info?.latestVersion
                          ? `v${update.info.latestVersion}`
                          : i18nService.t('updateNotChecked')}
                </span>
              </div>
              {isDownloading ? (
                <>
                  <Progress
                    value={
                      progress?.percent === undefined
                        ? null
                        : Math.min(100, Math.max(0, progress.percent * 100))
                    }
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {progress
                        ? `${formatBytes(progress.received)}${progress.total ? ` / ${formatBytes(progress.total)}` : ''}`
                        : i18nService.t('updateDownloading')}
                    </span>
                    <span>
                      {progress?.percent !== undefined
                        ? `${Math.round(progress.percent * 100)}%`
                        : ''}
                      {progress?.speed ? ` · ${formatBytes(progress.speed)}/s` : ''}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void window.electron.appUpdate.cancelDownload()}
                    >
                      {i18nService.t('updateDownloadCancel')}
                    </Button>
                  </div>
                </>
              ) : update?.status === AppUpdateStatus.Ready ? (
                <div className="space-y-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      void window.electron.appUpdate.installReady().then(result => {
                        if (!result.success) {
                          window.dispatchEvent(
                            new CustomEvent('app:showToast', {
                              detail: {
                                message: normalizeError(
                                  result.error || i18nService.t('updateInstallFailed'),
                                ),
                                isError: true,
                              },
                            }),
                          );
                        }
                      });
                    }}
                  >
                    {i18nService.t('updateReadyConfirm')}
                  </Button>
                  {update.readyFilePath ? (
                    <div className="flex items-center gap-2">
                      <span
                        className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                        title={update.readyFilePath}
                      >
                        {update.readyFilePath}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void window.electron.appUpdate.revealDownload().then(result => {
                            if (!result.success) {
                              window.dispatchEvent(
                                new CustomEvent('app:showToast', {
                                  detail: {
                                    message: result.error || i18nService.t('updateRevealFailed'),
                                    isError: true,
                                  },
                                }),
                              );
                            }
                          });
                        }}
                      >
                        {i18nService.t('updateRevealDownload')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : update?.status === AppUpdateStatus.Error && update.info ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-destructive">
                    {update.errorMessage || i18nService.t('updateDownloadFailed')}
                  </span>
                  <Button size="sm" onClick={() => void window.electron.appUpdate.retryDownload()}>
                    {i18nService.t('updateRetry')}
                  </Button>
                </div>
              ) : update?.status === AppUpdateStatus.Available ? (
                <div className="space-y-2">
                  {update.info?.manualDownloadOnly ? (
                    <div className="text-xs text-muted-foreground">
                      {i18nService.t('updateManualOnly')}
                    </div>
                  ) : null}
                  <Button size="sm" onClick={() => void window.electron.appUpdate.retryDownload()}>
                    {i18nService.t(
                      update.info?.manualDownloadOnly
                        ? 'updateOpenDownloadPage'
                        : 'updateDownloadNow',
                    )}
                  </Button>
                </div>
              ) : update?.status !== AppUpdateStatus.Checking &&
                update?.status !== AppUpdateStatus.UpToDate ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void window.electron.appUpdate.checkNow({ manual: true })}
                >
                  {i18nService.t('updateCheckNow')}
                </Button>
              ) : null}
              {update?.status === AppUpdateStatus.Error && !update.info ? (
                <div className="text-xs text-destructive">
                  {update.errorMessage || i18nService.t('updateCheckFailed')}
                </div>
              ) : null}
              {update?.lastCheckedAt ? (
                <div className="text-xs text-muted-foreground">
                  {i18nService.t('updateLastChecked')}
                  {new Date(update.lastCheckedAt).toLocaleString()}
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm text-foreground">GitHub</span>
              <a
                href="https://github.com/rongxinzy/RongxinAI"
                target="_blank"
                rel="noopener noreferrer"
                className="theme-surface-settings-link"
              >
                {i18nService.t('mcpViewOnGithub')}
              </a>
            </div>
          </>
        )}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm text-foreground">{i18nService.t('aboutOfficialWebsite')}</span>
          <a
            href={OFFICIAL_WEBSITE_URL}
            onClick={event => {
              event.preventDefault();
              void window.electron.shell.openExternal(OFFICIAL_WEBSITE_URL);
            }}
            rel="noopener noreferrer"
            className="theme-surface-settings-link"
          >
            {OFFICIAL_WEBSITE_URL}
          </a>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-foreground">{i18nService.t('aboutUsLabel')}</span>
          <a
            href="http://www.rongxzy.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="theme-surface-settings-link"
          >
            {i18nService.t('aboutCompanyName')}
          </a>
        </div>
      </div>
      <div className="mt-auto w-full pt-14 pb-2 flex flex-col items-center gap-2">
        {isDevBuild && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={e => {
                e.stopPropagation();
                void window.electron.window.openDevTools?.();
              }}
            >
              {i18nService.t('aboutOpenDevTools')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {i18nService.t('aboutDevToolsHint')}
            </span>
          </>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={e => {
            e.stopPropagation();
            void handleExportLogs();
          }}
          disabled={isExportingLogs}
        >
          {isExportingLogs ? i18nService.t('aboutExportingLogs') : i18nService.t('aboutExportLogs')}
        </Button>
      </div>
    </div>
  );
}
