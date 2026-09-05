import { Button } from '@shared/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@shared/components/ui/card';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Skeleton } from '@shared/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/components/ui/tooltip';
import { ArrowRightLeft, Download, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  LlamaCppBackendInfo,
  LlamaCppInstallProgress,
  LlamaCppRuntimeInstallSnapshot,
  LlamaCppStatusSnapshot,
} from '../../../../shared/llamacpp';
import { LlamaCppBackendError } from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import { BreathingDot } from './BreathingDot';
import { InstallProgressBar } from './Common';
import { LocalInferenceToastKind } from '../types';
import { formatBytes } from '../utils/progress';

const handledInstallerRequests = new Set<string>();

const RuntimeMetadataStatus = {
  Loading: 'loading',
  Ready: 'ready',
  Error: 'error',
} as const;
type RuntimeMetadataStatus = (typeof RuntimeMetadataStatus)[keyof typeof RuntimeMetadataStatus];

const RuntimeDownloadPhase = {
  Downloading: 'downloading',
  DownloadingProgress: 'downloading-progress',
} as const;

function translateRuntimeError(error: string | undefined): string | undefined {
  if (error === LlamaCppBackendError.CudaRequiresNvidiaGpu) {
    return i18nService.t('localInferenceCudaRequiresNvidiaGpu');
  }
  if (error === LlamaCppBackendError.SwitchRequiresStoppedService) {
    return i18nService.t('localInferenceBackendSwitchRequiresStoppedService');
  }
  return error;
}

type RuntimeInstallCardProps = {
  installRequestId?: string;
  runtimeInstallSnapshot: LlamaCppRuntimeInstallSnapshot;
  onInstallRequestHandled?: (requestId: string) => void;
  onNotify?: (message: string, kind: LocalInferenceToastKind, autoDismiss?: boolean) => void;
};

function isInstalled(status: LlamaCppStatusSnapshot | null): boolean {
  return Boolean(status && ['installed', 'starting', 'running', 'stopped'].includes(status.status));
}

function isActive(progress: LlamaCppInstallProgress | null): boolean {
  return Boolean(
    progress && !['done', 'failed', 'cancelled', 'needs-manual'].includes(progress.phase),
  );
}

function canCancel(progress: LlamaCppInstallProgress | null): boolean {
  return Boolean(
    progress && ['starting', 'downloading', 'downloading-progress'].includes(progress.phase),
  );
}

function isRuntimeDownloadProgress(progress: LlamaCppInstallProgress | null): boolean {
  return Boolean(
    progress &&
    (progress.phase === RuntimeDownloadPhase.Downloading ||
      progress.phase === RuntimeDownloadPhase.DownloadingProgress),
  );
}

export function RuntimeInstallCard({
  installRequestId,
  runtimeInstallSnapshot,
  onInstallRequestHandled,
  onNotify,
}: RuntimeInstallCardProps) {
  const [backends, setBackends] = useState<LlamaCppBackendInfo[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  // Keep an unresolved backend list distinct from a confirmed empty list.
  const [metadataStatus, setMetadataStatus] = useState<RuntimeMetadataStatus>(
    RuntimeMetadataStatus.Loading,
  );
  const [status, setStatus] = useState<LlamaCppStatusSnapshot | null>(null);
  const [error, setError] = useState<string>();
  const progress = runtimeInstallSnapshot.progress ?? null;
  const active = runtimeInstallSnapshot.active || isActive(progress);
  const cancellable = canCancel(progress);

  // Route transient runtime feedback through the page-level notification host.
  const notify = useCallback(
    (message: string, kind: LocalInferenceToastKind, autoDismiss = true) => {
      onNotify?.(message, kind, autoDismiss);
    },
    [onNotify],
  );

  const selectedBackend = useMemo(
    () => backends.find(backend => backend.versionBackend === selectedKey),
    [backends, selectedKey],
  );
  // The select may point to a candidate; only current marks the version already enabled.
  const currentBackend = useMemo(() => backends.find(backend => backend.current), [backends]);

  const loadMetadata = useCallback(async (): Promise<LlamaCppBackendInfo | undefined> => {
    const [nextStatus, list] = await Promise.all([
      window.electron.llamacpp.status(),
      window.electron.llamacpp.listBackends(),
    ]);
    setStatus(nextStatus);
    if (!list.success)
      throw new Error(list.error || i18nService.t('localInferenceBackendListFailed'));
    const compatible = list.backends.filter(
      backend =>
        backend.platform === window.electron.platform && backend.arch === window.electron.arch,
    );
    setBackends(compatible);
    const preferred =
      compatible.find(backend => backend.versionBackend === list.selection?.versionBackend) ??
      compatible.find(backend => backend.versionBackend === list.recommended?.versionBackend) ??
      compatible[0];
    setSelectedKey(current =>
      compatible.some(backend => backend.versionBackend === current)
        ? current
        : (preferred?.versionBackend ?? ''),
    );
    setMetadataStatus(RuntimeMetadataStatus.Ready);
    return preferred;
  }, []);

  const startInstall = useCallback(
    async (preferredBackend?: LlamaCppBackendInfo) => {
      if (active) return;
      setError(undefined);
      try {
        const backend = preferredBackend ?? selectedBackend ?? (await loadMetadata());
        const result = backend
          ? await window.electron.llamacpp.installBackend(backend)
          : await window.electron.llamacpp.install();
        if (!result.success && !result.cancelled) {
          setError(
            translateRuntimeError(result.error) || i18nService.t('localInferenceRuntimeMissing'),
          );
        }
        await loadMetadata();
        if (result.success) {
          notify(
            backend
              ? i18nService
                  .t('localInferenceRuntimeVersionSwitched')
                  .replace('{version}', backend.versionBackend)
              : i18nService.t('localInferenceRuntimeReady'),
            LocalInferenceToastKind.Success,
          );
        }
      } catch (installError) {
        setError(
          installError instanceof Error
            ? translateRuntimeError(installError.message)
            : i18nService.t('localInferenceRuntimeMissing'),
        );
      }
    },
    [active, loadMetadata, notify, selectedBackend],
  );

  useEffect(() => {
    void loadMetadata().catch(metadataError => {
      setMetadataStatus(RuntimeMetadataStatus.Error);
      setError(metadataError instanceof Error ? metadataError.message : String(metadataError));
    });
    return window.electron.llamacpp.onStatusChanged(setStatus);
  }, [loadMetadata]);

  useEffect(() => {
    if (!error) return;
    notify(error, LocalInferenceToastKind.Error);
  }, [error, notify]);

  useEffect(() => {
    if (!installRequestId || handledInstallerRequests.has(installRequestId)) return;
    handledInstallerRequests.add(installRequestId);
    // Consume the one-time navigation request before any async work can remount this card.
    onInstallRequestHandled?.(installRequestId);
    void loadMetadata()
      .then(backend => startInstall(backend))
      .catch(metadataError => {
        setError(metadataError instanceof Error ? metadataError.message : String(metadataError));
      });
  }, [installRequestId, loadMetadata, onInstallRequestHandled, startInstall]);

  const ready = isInstalled(status);
  const selectedInstalled = Boolean(selectedBackend?.installed);
  const selectedCurrent = Boolean(selectedBackend?.current);
  const metadataLoading = metadataStatus === RuntimeMetadataStatus.Loading;
  const downloading = active && isRuntimeDownloadProgress(progress);
  const downloadName = progress?.modelName || selectedBackend?.versionBackend || '';
  // The manifest may omit sizes, so wait for the downloader's server-confirmed total.
  const downloadTotal =
    progress?.total && progress.total > 0 ? formatBytes(progress.total) : undefined;
  const downloadSpeed =
    progress?.speed && progress.speed > 0 ? formatBytes(progress.speed) : undefined;
  const downloadProgress =
    progress?.completed !== undefined && downloadTotal
      ? i18nService
          .t('localInferenceRuntimeDownloadProgress')
          .replace('{completed}', formatBytes(progress.completed))
          .replace('{total}', downloadTotal)
      : undefined;
  const serviceRunning = status?.status === 'running';
  const serviceProgramAvailable = ready || Boolean(status?.executablePath);
  const serviceStatusLabel = serviceRunning
    ? i18nService.t('localInferenceRuntimeServiceRunning')
    : serviceProgramAvailable
      ? i18nService.t('localInferenceRuntimeServiceNotRunning')
      : i18nService.t('localInferenceRuntimeServiceUnavailable');
  const serviceStatusColor = serviceRunning
    ? 'var(--zy-success)'
    : serviceProgramAvailable
      ? 'var(--zy-warning)'
      : 'var(--zy-text-muted)';
  const cancelInstall = async () => {
    const result = await window.electron.llamacpp.cancelRuntimeInstall();
    if (result.cancelled) {
      notify(i18nService.t('localInferenceRuntimeInstallCancelled'), LocalInferenceToastKind.Info);
    }
  };

  return (
    <Card className="theme-page-runtime-install-card-card-1 relative">
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="absolute right-4 top-4 inline-flex">
              <BreathingDot color={serviceStatusColor} duration={2} label={serviceStatusLabel} />
            </span>
          }
        />
        <TooltipContent side="bottom" align="end">
          {serviceStatusLabel}
        </TooltipContent>
      </Tooltip>
      <CardHeader className="theme-control-sizing-6 gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            {!ready ? <Download className="size-4" /> : null}
            {i18nService.t('localInferenceRuntimeCardTitle')}
          </CardTitle>
        </div>
        <div>
          <Select
            value={selectedKey}
            onValueChange={value => setSelectedKey(value ?? '')}
            disabled={active || metadataLoading || backends.length === 0}
          >
            <SelectTrigger className="w-full" aria-busy={metadataLoading}>
              {metadataLoading ? (
                <Skeleton className="h-4 w-40" />
              ) : (
                <SelectValue>
                  {value =>
                    value ? (
                      <>
                        <span>{value}</span>
                        {selectedBackend?.recommended ? (
                          <>
                            <span> · </span>
                            <span className="font-semibold text-foreground">
                              {i18nService.t('localInferenceBackendRecommendedLabel')}
                            </span>
                          </>
                        ) : null}
                      </>
                    ) : (
                      i18nService.t('localInferenceBackendNone')
                    )
                  }
                </SelectValue>
              )}
            </SelectTrigger>
            <SelectContent
              alignItemWithTrigger={false}
              side="bottom"
              sideOffset={4}
              collisionAvoidance={{
                side: 'none',
                align: 'shift',
                fallbackAxisSide: 'none',
              }}
            >
              <SelectGroup>
                {backends.map(backend => {
                  return (
                    <SelectItem key={backend.versionBackend} value={backend.versionBackend}>
                      {backend.versionBackend}
                      {backend.recommended ? (
                        <>
                          <span> · </span>
                          <span className="font-semibold text-foreground">
                            {i18nService.t('localInferenceBackendRecommendedLabel')}
                          </span>
                        </>
                      ) : null}
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      {downloading ? (
        <CardContent className="theme-control-sizing-6 space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-foreground">
              {i18nService.t('localInferenceRuntimeDownloading').replace('{name}', downloadName)}
            </span>
            {downloadTotal ? (
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {i18nService
                  .t('localInferenceRuntimeDownloadTotal')
                  .replace('{size}', downloadTotal)}
              </span>
            ) : (
              <Skeleton className="h-4 w-20 shrink-0" />
            )}
          </div>
          <div className="flex items-center justify-between gap-3 text-xs tabular-nums text-muted-foreground">
            {downloadSpeed ? (
              <span>
                {i18nService
                  .t('localInferenceRuntimeDownloadSpeed')
                  .replace('{speed}', downloadSpeed)}
              </span>
            ) : (
              <Skeleton className="h-3 w-24" />
            )}
            {downloadProgress ? <span className="shrink-0">{downloadProgress}</span> : null}
          </div>
          <InstallProgressBar progress={progress ?? undefined} />
        </CardContent>
      ) : null}
      <CardFooter className="theme-page-runtime-install-card-card-footer-1 justify-between">
        <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {metadataLoading ? (
            <Skeleton className="h-4 w-36" />
          ) : currentBackend ? (
            i18nService
              .t('localInferenceRuntimeReadyWithBackend')
              .replace('{backend}', currentBackend.versionBackend)
          ) : (
            i18nService.t('localInferenceRuntimeNoSelectedVersion')
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Preserve identical control metrics while the install action changes to cancellation. */}
          {active && cancellable ? (
            <Button
              type="button"
              variant="outline"
              className="min-w-16"
              onClick={() => void cancelInstall()}
            >
              <X data-icon="inline-start" />
              {i18nService.t('cancel')}
            </Button>
          ) : active ? (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled
              aria-label={i18nService.t('localInferenceRuntimeInstalling')}
            >
              <LoaderCircle className="animate-spin" />
            </Button>
          ) : (
            <>
              {/* Keep installation separate from selecting an already installed version. */}
              <Button
                type="button"
                className="min-w-16"
                disabled={selectedInstalled}
                onClick={() => void startInstall()}
              >
                {error && !selectedInstalled ? (
                  <RotateCcw data-icon="inline-start" />
                ) : (
                  <Download data-icon="inline-start" />
                )}
                {error && !selectedInstalled
                  ? i18nService.t('localInferenceRuntimeRetry')
                  : i18nService.t('localInferenceInstall')}
              </Button>
              {selectedInstalled && !selectedCurrent ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void startInstall()}
                >
                  <ArrowRightLeft data-icon="inline-start" />
                  {i18nService.t('localInferenceRuntimeEnableVersion')}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
