import { Button } from '@shared/components/ui/button';
import {
  Card,
  CardContent,
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
import { CheckCircle2, Download, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  LlamaCppBackendInfo,
  LlamaCppInstallProgress,
  LlamaCppStatusSnapshot,
} from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import { InstallProgressBar } from './Common';
import { formatBytes, formatInstallProgressSummary } from '../utils/progress';

const RUNTIME_PROGRESS_KEY = '__llamacpp_runtime__';
const handledInstallerRequests = new Set<string>();

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
  const [resolvedDownloadSize, setResolvedDownloadSize] = useState<{
    backendKey: string;
    sizeBytes?: number;
  }>();
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
    if (backend.downloadSizeBytes !== undefined) {
      setResolvedDownloadSize({
        backendKey: backend.versionBackend,
        sizeBytes: backend.downloadSizeBytes,
      });
      return;
    }
    const result = await window.electron.llamacpp.getBackendDownloadSize(backend);
    setResolvedDownloadSize({
      backendKey: backend.versionBackend,
      sizeBytes: result.success ? result.sizeBytes : undefined,
    });
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
    if (!selectedBackend) return;
    void loadDownloadSize(selectedBackend);
  }, [loadDownloadSize, selectedBackend]);

  const summary = progress ? formatInstallProgressSummary(progress) : null;
  const ready = isInstalled(status);
  const backendLabel =
    selectedBackend?.versionBackend ?? i18nService.t('localInferenceBackendNone');
  const selectedDownloadSize =
    selectedBackend?.downloadSizeBytes ??
    (resolvedDownloadSize?.backendKey === selectedBackend?.versionBackend
      ? resolvedDownloadSize?.sizeBytes
      : undefined);
  const sizeLabel = selectedDownloadSize
    ? i18nService
        .t('localInferenceRuntimeDownloadSize')
        .replace('{size}', formatBytes(selectedDownloadSize))
    : i18nService.t('localInferenceRuntimeDownloadSizeUnknown');

  const cancelInstall = async () => {
    setProgress(current => ({
      ...(current ?? { modelId: RUNTIME_PROGRESS_KEY }),
      phase: 'cancelling',
    }));
    await window.electron.llamacpp.cancelRuntimeInstall();
  };

  return (
    <Card className="gap-3 border-primary/20 bg-primary/[0.03]">
      <CardHeader className="grid-cols-[1fr_auto] px-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            {ready ? (
              <CheckCircle2 className="size-4 text-emerald-500" />
            ) : (
              <Download className="size-4" />
            )}
            {i18nService.t('localInferenceRuntimeCardTitle')}
          </CardTitle>
          <CardDescription className="mt-1">
            {ready
              ? i18nService.t('localInferenceRuntimeReady')
              : i18nService.t('localInferenceRuntimeCardDescription')}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={selectedKey}
            onValueChange={value => setSelectedKey(value ?? '')}
            disabled={active || backends.length === 0}
          >
            <SelectTrigger className="max-w-64">
              <SelectValue placeholder={i18nService.t('localInferenceBackendNone')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {backends.map(backend => (
                  <SelectItem key={backend.versionBackend} value={backend.versionBackend}>
                    {backend.versionBackend}
                    {backend.recommended
                      ? ` · ${i18nService.t('localInferenceBackendRecommendedLabel')}`
                      : ''}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
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
            <Button type="button" variant="outline" size="sm" onClick={() => void startInstall()}>
              {error ? (
                <RotateCcw data-icon="inline-start" />
              ) : (
                <Download data-icon="inline-start" />
              )}
              {error
                ? i18nService.t('localInferenceRuntimeRetry')
                : i18nService.t('localInferenceBackendUpdate')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 px-0">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{backendLabel}</span>
          <span>{sizeLabel}</span>
        </div>
        {progress ? <InstallProgressBar progress={progress} /> : null}
        {summary ? (
          <div className="text-xs text-muted-foreground">
            {summary.phase ? `${summary.phase} · ` : ''}
            {summary.primary}
          </div>
        ) : null}
        {error ? <div className="text-xs text-destructive">{error}</div> : null}
      </CardContent>
    </Card>
  );
}
