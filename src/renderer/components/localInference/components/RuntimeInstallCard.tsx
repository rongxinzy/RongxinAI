import { Button } from '@shared/components/ui/button';
import { Button21st } from '@shared/components/ui/button-21st';
import {
  Card,
  CardContent,
  CardFooter,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/components/ui/tooltip';
import { Download, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  LlamaCppBackendInfo,
  LlamaCppInstallProgress,
  LlamaCppStatusSnapshot,
} from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import { InstallProgressBar } from './Common';
import { BreathingDot } from './BreathingDot';
import { formatBytes, formatInstallProgressSummary } from '../utils/progress';

const RUNTIME_PROGRESS_KEY = '__llamacpp_runtime__';
const handledInstallerRequests = new Set<string>();

function formatCompactBytes(value: number): string {
  return formatBytes(value).replace(' ', '');
}

type RuntimeInstallCardProps = {
  installRequestId?: string;
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
  return Boolean(progress && ['starting', 'downloading', 'downloading-progress'].includes(progress.phase));
}

export function RuntimeInstallCard({ installRequestId }: RuntimeInstallCardProps) {
  const [backends, setBackends] = useState<LlamaCppBackendInfo[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [status, setStatus] = useState<LlamaCppStatusSnapshot | null>(null);
  const [progress, setProgress] = useState<LlamaCppInstallProgress | null>(null);
  const [error, setError] = useState<string>();
  const [resolvedDownloadSizes, setResolvedDownloadSizes] = useState<Record<string, number>>({});
  const active = isActive(progress);
  const cancellable = canCancel(progress);

  const selectedBackend = useMemo(
    () => backends.find(backend => backend.versionBackend === selectedKey),
    [backends, selectedKey],
  );

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
    return preferred;
  }, []);

  const loadDownloadSize = useCallback(async (backend: LlamaCppBackendInfo): Promise<void> => {
    const sizeBytes =
      backend.downloadSizeBytes ??
      (await window.electron.llamacpp.getBackendDownloadSize(backend)).sizeBytes;
    if (sizeBytes === undefined) return;
    setResolvedDownloadSizes(current => ({
      ...current,
      [backend.versionBackend]: sizeBytes,
    }));
  }, []);

  const startInstall = useCallback(
    async (preferredBackend?: LlamaCppBackendInfo) => {
      if (active) return;
      setError(undefined);
      try {
        const backend = preferredBackend ?? selectedBackend ?? (await loadMetadata());
        setProgress({ phase: 'starting', modelId: RUNTIME_PROGRESS_KEY });
        // Metadata is optional presentation data. Do not put a network HEAD
        // request in front of the cancellable runtime install IPC.
        if (backend) void loadDownloadSize(backend);
        const result = backend
          ? await window.electron.llamacpp.installBackend(backend)
          : await window.electron.llamacpp.install();
        if (!result.success && !result.cancelled) {
          setError(result.error || i18nService.t('localInferenceRuntimeMissing'));
        }
        await loadMetadata();
      } catch (installError) {
        setError(
          installError instanceof Error
            ? installError.message
            : i18nService.t('localInferenceRuntimeMissing'),
        );
        setProgress(current => ({
          ...(current ?? { modelId: RUNTIME_PROGRESS_KEY }),
          phase: 'failed',
        }));
      }
    },
    [active, loadDownloadSize, loadMetadata, selectedBackend],
  );

  useEffect(() => {
    void loadMetadata().catch(metadataError => {
      setError(metadataError instanceof Error ? metadataError.message : String(metadataError));
    });
    return window.electron.llamacpp.onStatusChanged(setStatus);
  }, [loadMetadata]);

  useEffect(
    () =>
      window.electron.llamacpp.onInstallProgress(nextProgress => {
        if (nextProgress.modelId !== RUNTIME_PROGRESS_KEY) return;
        setProgress(nextProgress);
        if (nextProgress.phase === 'failed') {
          setError(nextProgress.error || i18nService.t('localInferenceRuntimeMissing'));
        } else if (nextProgress.phase === 'done') {
          setError(undefined);
        }
      }),
    [],
  );

  useEffect(() => {
    if (!installRequestId || handledInstallerRequests.has(installRequestId)) return;
    handledInstallerRequests.add(installRequestId);
    void loadMetadata()
      .then(backend => startInstall(backend))
      .catch(metadataError => {
        setError(metadataError instanceof Error ? metadataError.message : String(metadataError));
      });
  }, [installRequestId, loadMetadata, startInstall]);

  useEffect(() => {
    if (backends.length === 0) return;
    void Promise.all(backends.map(backend => loadDownloadSize(backend)));
  }, [backends, loadDownloadSize]);

  const summary = progress ? formatInstallProgressSummary(progress) : null;
  const ready = isInstalled(status);
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
  const runtimeBackendLabel =
    status?.versionBackend?.trim() ||
    selectedBackend?.versionBackend ||
    i18nService.t('localInferenceBackendNone');

  const cancelInstall = async () => {
    setProgress(current => ({
      ...(current ?? { modelId: RUNTIME_PROGRESS_KEY }),
      phase: 'cancelling',
    }));
    await window.electron.llamacpp.cancelRuntimeInstall();
  };

  return (
    <Card className="relative gap-2 border-primary/20 bg-primary/[0.03]">
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
      <CardHeader className="gap-3 px-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            {!ready ? (
              <Download className="size-4" />
            ) : null}
            {i18nService.t('localInferenceRuntimeCardTitle')}
          </CardTitle>
        </div>
        <div className="-mx-4 w-auto px-1.5">
          <Select
            value={selectedKey}
            onValueChange={value => setSelectedKey(value ?? '')}
            disabled={active || backends.length === 0}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={i18nService.t('localInferenceBackendNone')} />
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
                  const downloadSize =
                    backend.downloadSizeBytes ?? resolvedDownloadSizes[backend.versionBackend];
                  return (
                    <SelectItem key={backend.versionBackend} value={backend.versionBackend}>
                      {backend.versionBackend}
                      {downloadSize !== undefined
                        ? ` · ${formatCompactBytes(downloadSize)}`
                        : ''}
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
      {progress || summary || error ? (
        <CardContent className="space-y-2 px-0">
          {progress ? <InstallProgressBar progress={progress} /> : null}
          {summary ? (
            <div className="text-xs text-muted-foreground">
              {summary.phase ? `${summary.phase} · ` : ''}
              {summary.primary}
            </div>
          ) : null}
          {error ? <div className="text-xs text-destructive">{error}</div> : null}
        </CardContent>
      ) : null}
      <CardFooter className="justify-between border-0 bg-transparent p-0 pb-2">
        <CardDescription>
          {ready
            ? i18nService
                .t('localInferenceRuntimeReadyWithBackend')
                .replace('{backend}', runtimeBackendLabel)
            : i18nService.t('localInferenceRuntimeNotInstalledMessage')}
        </CardDescription>
        {active && cancellable ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void cancelInstall()}>
            <X data-icon="inline-start" />
            {i18nService.t('cancel')}
          </Button>
        ) : active ? (
          <Button type="button" variant="outline" size="sm" disabled>
            {i18nService.t('localInferenceRuntimeInstalling')}
          </Button>
        ) : (
          <Button21st
            type="button"
            variant="primary"
            size="sm"
            className="-mr-2.5 h-8 min-w-16 px-3"
            onClick={() => void startInstall()}
          >
            {error ? <RotateCcw data-icon="inline-start" /> : <Download data-icon="inline-start" />}
            {error
              ? i18nService.t('localInferenceRuntimeRetry')
              : i18nService.t('localInferenceBackendUpdate')}
          </Button21st>
        )}
      </CardFooter>
    </Card>
  );
}
