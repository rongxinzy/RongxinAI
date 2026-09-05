import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Progress } from '@shared/components/ui/progress';
import { cn } from '@shared/lib/utils';
import { BadgeCheck, Check, Download, ShieldCheck, X } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';

import type { LlamaCppInstallProgress } from '../../../../shared/llamacpp';
import type { MarketplaceModel } from '../../../../shared/marketplace';
import { i18nService } from '../../../services/i18n';
import { LOCAL_INFERENCE_MODEL_LAUNCH_LOG_TRANSITION_MS } from '../constants';
import {
  capabilityLabel,
  getMarketplaceCapabilityTags,
  getMarketplaceDisplayName,
  groupMarketplaceVariants,
  MARKETPLACE_GGUF_FORMAT,
} from '../utils/marketplace';
import {
  formatBytes,
  formatPullProgress,
  isPullInProgress,
  progressBarPercent,
} from '../utils/progress';

const MARKETPLACE_DOWNLOAD_SIDEBAR_MIN_WIDTH = 320;
const MARKETPLACE_DOWNLOAD_SIDEBAR_MAX_WIDTH = 480;
const MARKETPLACE_DOWNLOAD_SIDEBAR_MAIN_CONTENT_MIN_WIDTH = 520;
const MARKETPLACE_DOWNLOAD_SIDEBAR_COMPACT_BREAKPOINT = 900;

const MarketplaceDownloadProgressPhase = {
  Cancelled: 'cancelled',
  Detecting: 'detecting',
  Done: 'done',
  Failed: 'failed',
} as const;

const MarketplaceDownloadStageStatus = {
  Active: 'active',
  Complete: 'complete',
  Failed: 'failed',
  Pending: 'pending',
} as const;

type MarketplaceDownloadStageStatus =
  (typeof MarketplaceDownloadStageStatus)[keyof typeof MarketplaceDownloadStageStatus];

export function MarketplaceDownloadSidebar({
  visible,
  model,
  progress,
  onClose,
  onCancel,
}: {
  visible: boolean;
  model: MarketplaceModel | null;
  progress?: LlamaCppInstallProgress;
  onClose: () => void;
  onCancel: (modelId: string) => void;
}) {
  const sidebarRef = useRef<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(() => getMaxSidebarWidth());
  const [isResizing, setIsResizing] = useState(false);
  const resizeFrameRef = useRef(0);
  const pendingResizeWidthRef = useRef(0);

  useEffect(() => {
    const container = sidebarRef.current?.parentElement;
    if (!container) return;

    const updateContainerWidth = () => setContainerWidth(container.getBoundingClientRect().width);
    updateContainerWidth();
    if (typeof ResizeObserver === 'undefined') return;

    const resizeObserver = new ResizeObserver(updateContainerWidth);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (containerWidth <= 0) return;
    setSidebarWidth(current => Math.min(current, getMaxSidebarWidth(containerWidth)));
  }, [containerWidth]);

  const isCompact =
    containerWidth > 0 && containerWidth < MARKETPLACE_DOWNLOAD_SIDEBAR_COMPACT_BREAKPOINT;
  const visibleWidth = visible ? sidebarWidth : 0;

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = sidebarWidth;
    pendingResizeWidthRef.current = startWidth;
    const originalCursor = document.body.style.cursor;
    const originalUserSelect = document.body.style.userSelect;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      // Coalesce pointermove bursts into one state update per animation frame.
      pendingResizeWidthRef.current = clampSidebarWidth(
        startWidth + startX - moveEvent.clientX,
        getMaxSidebarWidth(containerWidth),
      );
      if (resizeFrameRef.current) return;
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = 0;
        setSidebarWidth(pendingResizeWidthRef.current);
      });
    };
    const handlePointerEnd = () => {
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = 0;
      }
      setSidebarWidth(pendingResizeWidthRef.current);
      setIsResizing(false);
      document.body.style.cursor = originalCursor;
      document.body.style.userSelect = originalUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
  };

  return (
    <aside
      aria-hidden={!visible}
      ref={sidebarRef}
      data-marketplace-download-sidebar
      className={cn(
        'flex h-full overflow-hidden bg-background transition-[width] ease-in-out',
        isCompact ? 'absolute inset-y-0 right-0 z-30 shadow-xl' : 'relative shrink-0',
      )}
      style={{
        width: visibleWidth,
        transitionDuration: `${LOCAL_INFERENCE_MODEL_LAUNCH_LOG_TRANSITION_MS}ms`,
      }}
    >
      {visible && !isCompact ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={i18nService.t('marketplaceDownloadResize')}
          className={cn(
            'absolute inset-y-0 left-0 z-40 flex w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center',
            'after:h-full after:w-px after:bg-border after:transition-colors after:duration-200 hover:after:bg-border',
            isResizing && 'after:bg-border',
          )}
          onPointerDown={handleResizePointerDown}
        />
      ) : null}
      {model ? (
        <MarketplaceDownloadSidebarContent
          model={model}
          progress={progress}
          onClose={onClose}
          onCancel={onCancel}
        />
      ) : null}
    </aside>
  );
}

function MarketplaceDownloadSidebarContent({
  model,
  progress,
  onClose,
  onCancel,
}: {
  model: MarketplaceModel;
  progress?: LlamaCppInstallProgress;
  onClose: () => void;
  onCancel: (modelId: string) => void;
}) {
  const displayName = getMarketplaceDisplayName(model.repoId);
  const variants = groupMarketplaceVariants(model.files);
  const selectedVariant =
    variants.find(variant => variant.files.some(file => file.path === model.filePath)) ??
    variants[0];
  const phase = progress?.phase;
  const hasFailed =
    phase === MarketplaceDownloadProgressPhase.Failed ||
    phase === MarketplaceDownloadProgressPhase.Cancelled;
  const isComplete = phase === MarketplaceDownloadProgressPhase.Done;
  const isVerifying = phase === MarketplaceDownloadProgressPhase.Detecting;
  const downloadStatus =
    isComplete || isVerifying
      ? MarketplaceDownloadStageStatus.Complete
      : hasFailed
        ? MarketplaceDownloadStageStatus.Failed
        : MarketplaceDownloadStageStatus.Active;
  const verificationStatus = isComplete
    ? MarketplaceDownloadStageStatus.Complete
    : hasFailed
      ? MarketplaceDownloadStageStatus.Failed
      : isVerifying
        ? MarketplaceDownloadStageStatus.Active
        : MarketplaceDownloadStageStatus.Pending;
  const readyStatus = isComplete
    ? MarketplaceDownloadStageStatus.Complete
    : hasFailed
      ? MarketplaceDownloadStageStatus.Failed
      : MarketplaceDownloadStageStatus.Pending;
  const isCancellable = isPullInProgress(progress);
  const tags = [
    MARKETPLACE_GGUF_FORMAT,
    selectedVariant?.quantization,
    selectedVariant?.totalSizeBytes ? formatBytes(selectedVariant.totalSizeBytes) : model.sizes[0],
    ...getMarketplaceCapabilityTags(model).map(capabilityLabel),
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex min-h-16 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-base font-semibold leading-6 text-foreground">
              {displayName}
            </h2>
            {model.metadataStatus === 'verified' ? (
              <Badge variant="secondary" className="shrink-0 gap-1 text-success">
                <BadgeCheck className="size-3.5" aria-hidden="true" />
                {i18nService.t('marketplaceDownloadVerified')}
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">{model.repoId}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={i18nService.t('close')}
          onClick={onClose}
        >
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-wrap gap-1.5">
          {tags.map(tag => (
            <Badge
              key={tag}
              variant="outline"
              className="theme-page-marketplace-download-sidebar-badge-1"
            >
              {tag}
            </Badge>
          ))}
        </div>

        <div
          className="mt-6 flex flex-col gap-1"
          aria-label={i18nService.t('marketplaceDownloadPipeline')}
        >
          <MarketplaceDownloadStage
            status={downloadStatus}
            icon={Download}
            title={i18nService.t('marketplaceDownloadStageDownload')}
            detail={
              progress ? formatPullProgress(progress) : i18nService.t('marketplaceInstallPulling')
            }
            progress={progressBarPercent(progress)}
            showConnector
          />
          <MarketplaceDownloadStage
            status={verificationStatus}
            icon={ShieldCheck}
            title={i18nService.t('marketplaceDownloadStageVerification')}
            detail={getVerificationDetail(verificationStatus)}
            showConnector
          />
          <MarketplaceDownloadStage
            status={readyStatus}
            icon={Check}
            title={i18nService.t('marketplaceDownloadStageReady')}
            detail={getReadyDetail(readyStatus)}
          />
          {isCancellable ? (
            <div className="mt-1 flex justify-end pl-12">
              <Button type="button" variant="destructive" onClick={() => onCancel(model.repoId)}>
                <X data-icon="inline-start" />
                {i18nService.t('marketplaceCancelInstall')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MarketplaceDownloadStage({
  status,
  icon: Icon,
  title,
  detail,
  progress,
  showConnector = false,
}: {
  status: MarketplaceDownloadStageStatus;
  icon: typeof Download;
  title: string;
  detail: string;
  progress?: number;
  showConnector?: boolean;
}) {
  const statusClassName = {
    [MarketplaceDownloadStageStatus.Active]: 'border-primary/30 bg-primary/10 text-primary',
    [MarketplaceDownloadStageStatus.Complete]: 'border-success/30 bg-success/10 text-success',
    [MarketplaceDownloadStageStatus.Failed]:
      'border-destructive/30 bg-destructive/10 text-destructive',
    [MarketplaceDownloadStageStatus.Pending]: 'border-border bg-muted text-muted-foreground',
  } satisfies Record<MarketplaceDownloadStageStatus, string>;

  return (
    <div className="relative flex gap-3 pb-5 last:pb-0">
      <div className="relative z-10 flex flex-col items-center">
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full border',
            statusClassName[status],
          )}
        >
          <Icon className="size-4" />
        </span>
        {showConnector ? (
          <span
            aria-hidden="true"
            className="absolute top-9 h-[calc(100%-2.25rem)] w-px bg-border"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
        {progress !== undefined ? <Progress className="mt-2" value={progress} /> : null}
      </div>
    </div>
  );
}

function getVerificationDetail(status: MarketplaceDownloadStageStatus): string {
  if (status === MarketplaceDownloadStageStatus.Active)
    return i18nService.t('localInferenceInstallVerifying');
  if (status === MarketplaceDownloadStageStatus.Complete)
    return i18nService.t('marketplaceDownloadCompleted');
  if (status === MarketplaceDownloadStageStatus.Failed)
    return i18nService.t('marketplaceInstallFailed');
  return i18nService.t('marketplaceDownloadQueued');
}

function getReadyDetail(status: MarketplaceDownloadStageStatus): string {
  if (status === MarketplaceDownloadStageStatus.Complete)
    return i18nService.t('marketplaceInstalled');
  if (status === MarketplaceDownloadStageStatus.Failed)
    return i18nService.t('marketplaceInstallFailed');
  return i18nService.t('marketplaceDownloadWaiting');
}

function clampSidebarWidth(width: number, maxWidth: number): number {
  return Math.min(Math.max(width, MARKETPLACE_DOWNLOAD_SIDEBAR_MIN_WIDTH), maxWidth);
}

function getMaxSidebarWidth(containerWidth = 0): number {
  const availableWidth =
    containerWidth ||
    (typeof window === 'undefined' ? MARKETPLACE_DOWNLOAD_SIDEBAR_MAX_WIDTH : window.innerWidth);
  if (availableWidth < MARKETPLACE_DOWNLOAD_SIDEBAR_COMPACT_BREAKPOINT) {
    return Math.min(MARKETPLACE_DOWNLOAD_SIDEBAR_MAX_WIDTH, availableWidth);
  }
  return Math.max(
    MARKETPLACE_DOWNLOAD_SIDEBAR_MIN_WIDTH,
    Math.min(
      MARKETPLACE_DOWNLOAD_SIDEBAR_MAX_WIDTH,
      availableWidth - MARKETPLACE_DOWNLOAD_SIDEBAR_MAIN_CONTENT_MIN_WIDTH,
    ),
  );
}
