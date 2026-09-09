import { Button } from '@shared/components/ui/button';
import { FluidTabs, FluidTabsSize } from '@shared/components/ui/fluid-tabs';
import { cn } from '@shared/lib/utils';
import { ScrollText, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type TransitionEvent as ReactTransitionEvent,
} from 'react';

import type {
  LlamaCppModel,
  LlamaCppModelPreference,
  LlamaCppRunningModel,
  LlamaCppServiceConfig,
} from '../../../../shared/llamacpp';
import { ModelCapabilityStatus } from '../../../../shared/providers';
import { i18nService } from '../../../services/i18n';
import { LOCAL_INFERENCE_MODEL_LAUNCH_LOG_TRANSITION_MS } from '../constants';
import { formatBytes } from '../utils/progress';
import {
  ModelContextSettingsModal,
  ModelContextSettingsPresentation,
} from './ModelContextSettingsModal';
import { formatModelInspectorContext } from './modelInspectorViewModel';

export const ModelInspectorTab = {
  Overview: 'overview',
  Parameters: 'parameters',
  Logs: 'logs',
} as const;
export type ModelInspectorTab = (typeof ModelInspectorTab)[keyof typeof ModelInspectorTab];

const MODEL_INSPECTOR_TRANSITION_FALLBACK_MS = 50;
const MODEL_INSPECTOR_SIDEBAR_MIN_WIDTH = 300;
const MODEL_INSPECTOR_SIDEBAR_MAX_WIDTH = 560;
const MODEL_INSPECTOR_MAIN_CONTENT_MIN_WIDTH = 520;
const MODEL_INSPECTOR_COMPACT_BREAKPOINT = 900;

type ModelInspectorSidebarProps = {
  open: boolean;
  model: LlamaCppModel | null;
  runningModel?: LlamaCppRunningModel;
  preference?: LlamaCppModelPreference;
  serviceConfig: LlamaCppServiceConfig;
  onOpenChange: (open: boolean) => void;
  onSaveContext: (ctxSize: number) => void;
  onOpenLogs: (modelName: string) => void;
};

type InspectorRow = {
  label: string;
  value: string;
};

type InspectorSnapshot = {
  model: LlamaCppModel;
  runningModel?: LlamaCppRunningModel;
  preference?: LlamaCppModelPreference;
  serviceConfig: LlamaCppServiceConfig;
};

export function ModelInspectorSidebar({
  open,
  model,
  runningModel,
  preference,
  serviceConfig,
  onOpenChange,
  onSaveContext,
  onOpenLogs,
}: ModelInspectorSidebarProps) {
  const [activeTab, setActiveTab] = useState<ModelInspectorTab>(ModelInspectorTab.Overview);
  const [isPresent, setIsPresent] = useState(open);
  const [isEntered, setIsEntered] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(() => getMaxSidebarWidth());
  const resizeFrameRef = useRef(0);
  const pendingResizeWidthRef = useRef(0);
  const [snapshot, setSnapshot] = useState<InspectorSnapshot | null>(
    model
      ? {
          model,
          runningModel,
          preference,
          serviceConfig,
        }
      : null,
  );
  const activeSnapshot = open && model
    ? { model, runningModel, preference, serviceConfig }
    : snapshot;
  const inspectedModel = activeSnapshot?.model;

  useEffect(() => {
    if (open && model) {
      setSnapshot({ model, runningModel, preference, serviceConfig });
    }
  }, [model, open, preference, runningModel, serviceConfig]);

  useEffect(() => {
    const container = sidebarRef.current?.parentElement;
    if (!container) return;

    const updateContainerWidth = () => {
      setContainerWidth(container.getBoundingClientRect().width);
    };
    updateContainerWidth();

    if (typeof ResizeObserver === 'undefined') return;
    const resizeObserver = new ResizeObserver(updateContainerWidth);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [isPresent]);

  useEffect(() => {
    if (containerWidth <= 0) return;
    setSidebarWidth(current => Math.min(current, getMaxSidebarWidth(containerWidth)));
  }, [containerWidth]);

  useEffect(() => {
    if (open) {
      setIsClosing(false);
      setSidebarWidth(getMaxSidebarWidth(containerWidth));
      if (!isPresent) {
        setIsPresent(true);
        return;
      }

      const frame = window.requestAnimationFrame(() => setIsEntered(true));
      return () => window.cancelAnimationFrame(frame);
    }

    setIsEntered(false);
    if (!isPresent) return;
    setIsClosing(true);
    const timeout = window.setTimeout(() => {
      setIsPresent(false);
      setIsClosing(false);
    }, LOCAL_INFERENCE_MODEL_LAUNCH_LOG_TRANSITION_MS + MODEL_INSPECTOR_TRANSITION_FALLBACK_MS);

    return () => window.clearTimeout(timeout);
  }, [containerWidth, isPresent, open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenChange, open]);

  if (!isPresent || !activeSnapshot || !inspectedModel) return null;
  const overviewRows = getOverviewRows(
    inspectedModel,
    activeSnapshot.preference,
    activeSnapshot.serviceConfig,
  );
  const fixedParameterRows = getFixedParameterRows(
    activeSnapshot.preference,
    activeSnapshot.serviceConfig,
  );
  const runtimeConfigRows = [
    ...overviewRows.slice(0, 2),
    ...fixedParameterRows.slice(0, 2),
    ...overviewRows.slice(2),
    ...fixedParameterRows.slice(2),
  ];
  const completeCloseTransition = () => {
    if (!isClosing || open) return;
    setIsPresent(false);
    setIsClosing(false);
  };
  const handleTransitionEnd = (event: ReactTransitionEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform') return;
    completeCloseTransition();
  };
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
      aria-hidden={!open}
      ref={sidebarRef}
      onTransitionEnd={handleTransitionEnd}
      className="absolute inset-y-0 right-0 z-30 flex h-full overflow-hidden border-l border-border-subtle bg-surface shadow-xl transition-[width,transform] ease-(--ease-smooth)"
      style={{
        width: isClosing ? sidebarWidth : isEntered ? sidebarWidth : 0,
        transform: isClosing ? 'translateX(100%)' : 'translateX(0)',
        transitionProperty: isClosing ? 'transform' : 'width',
        transitionDuration: `${LOCAL_INFERENCE_MODEL_LAUNCH_LOG_TRANSITION_MS}ms`,
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={i18nService.t('localInferenceInspectorResize')}
        className={cn(
          'absolute inset-y-0 left-0 z-40 flex w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center',
          'after:h-full after:w-px after:bg-transparent after:transition-colors after:duration-200 hover:after:bg-border',
          isResizing && 'after:bg-border',
        )}
        onPointerDown={handleResizePointerDown}
      />
      <div
        className={cn(
          'flex h-full w-full shrink-0 flex-col overflow-hidden transition-[transform,opacity] ease-(--ease-smooth)',
          isEntered || isClosing ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0',
          isClosing && 'pointer-events-none',
        )}
        style={{ transitionDuration: `${LOCAL_INFERENCE_MODEL_LAUNCH_LOG_TRANSITION_MS}ms` }}
      >
        <header className="flex h-12 min-w-0 items-center justify-between gap-3 border-b border-border px-3">
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-base font-semibold leading-6 text-foreground">
                {i18nService.t('localInferenceInspectorTitle')}
              </h2>
              <p className="truncate text-xs text-muted-foreground" title={inspectedModel.name}>
                {inspectedModel.name}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={i18nService.t('close')}
            onClick={() => onOpenChange(false)}
          >
            <X />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <FluidTabs
            aria-label={i18nService.t('localInferenceInspectorTitle')}
            size={FluidTabsSize.Small}
            value={activeTab}
            onValueChange={setActiveTab}
            items={[
              { value: ModelInspectorTab.Overview, label: i18nService.t('localInferenceInspectorOverview') },
              { value: ModelInspectorTab.Parameters, label: i18nService.t('localInferenceInspectorParameters') },
              { value: ModelInspectorTab.Logs, label: i18nService.t('localInferenceInspectorLogs') },
            ]}
          />

          {activeTab === ModelInspectorTab.Overview ? (
            <div className="mt-5 flex flex-col gap-5">
              <InspectorRuntimeConfig rows={runtimeConfigRows} />
              <ModelContextSettingsModal
                isOpen={open}
                model={inspectedModel}
                savedContextSize={activeSnapshot.preference?.ctxSize}
                runningContextSize={
                  activeSnapshot.runningModel?.runtime_context_length ??
                  activeSnapshot.runningModel?.context_length
                }
                onClose={() => onOpenChange(false)}
                onSave={ctxSize => {
                  if (ctxSize !== undefined) onSaveContext(ctxSize);
                }}
                presentation={ModelContextSettingsPresentation.Inline}
              />
            </div>
          ) : null}

          {activeTab === ModelInspectorTab.Logs ? (
            <div className="mt-5 flex flex-col gap-4 rounded-lg border border-border-subtle bg-muted/20 p-3">
              <p className="text-sm leading-6 text-muted-foreground">
                {i18nService.t('localInferenceInspectorLogsDescription')}
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => onOpenLogs(inspectedModel.name)}
              >
                <ScrollText data-icon="inline-start" />
                {i18nService.t('localInferenceInspectorOpenLogs')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function clampSidebarWidth(width: number, maxWidth = getMaxSidebarWidth()): number {
  return Math.min(
    Math.max(width, MODEL_INSPECTOR_SIDEBAR_MIN_WIDTH),
    Math.max(MODEL_INSPECTOR_SIDEBAR_MIN_WIDTH, maxWidth),
  );
}

function getMaxSidebarWidth(containerWidth = 0): number {
  const availableWidth =
    containerWidth > 0
      ? containerWidth
      : typeof window === 'undefined'
        ? MODEL_INSPECTOR_SIDEBAR_MAX_WIDTH
        : window.innerWidth;

  if (availableWidth < MODEL_INSPECTOR_COMPACT_BREAKPOINT) {
    return Math.min(MODEL_INSPECTOR_SIDEBAR_MAX_WIDTH, availableWidth);
  }

  return Math.max(
    MODEL_INSPECTOR_SIDEBAR_MIN_WIDTH,
    Math.min(
      MODEL_INSPECTOR_SIDEBAR_MAX_WIDTH,
      availableWidth - MODEL_INSPECTOR_MAIN_CONTENT_MIN_WIDTH,
    ),
  );
}

function InspectorRuntimeConfig({ rows }: { rows: InspectorRow[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border-subtle bg-surface">
      <header className="flex min-w-0 items-baseline gap-2 border-b border-border-subtle px-3 py-2.5">
        <h3 className="shrink-0 text-sm font-semibold text-foreground">
          {i18nService.t('localInferenceInspectorRuntimeConfig')}
        </h3>
        <span className="truncate text-xs text-muted-foreground">
          {i18nService.t('localInferenceInspectorRuntimeConfigHint')}
        </span>
      </header>
      <dl className="grid grid-cols-2">
        {rows.map((row, index) => (
          <div
            key={row.label}
            className={cn(
              'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border-subtle px-3 py-2.5 transition-colors duration-150 ease-out',
              Math.floor(index / 2) % 2 === 0 ? 'bg-surface' : 'bg-muted/50',
              index % 2 === 1 && 'border-l border-border-subtle',
              index === rows.length - 1 && 'border-b-0',
            )}
          >
            <dt className="truncate text-sm text-muted-foreground" title={row.label}>
              {row.label}
            </dt>
            <dd className="max-w-full truncate text-right text-sm font-medium text-foreground" title={row.value}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function getOverviewRows(
  model: LlamaCppModel,
  preference: LlamaCppModelPreference | undefined,
  serviceConfig: LlamaCppServiceConfig,
): InspectorRow[] {
  return [
    {
      label: i18nService.t('localInferenceQuantization'),
      value: model.details?.quantization_level || i18nService.t('localInferenceInspectorUnavailable'),
    },
    {
      label: i18nService.t('localInferenceSize'),
      value: model.size ? formatBytes(model.size) : i18nService.t('localInferenceInspectorUnavailable'),
    },
    {
      label: i18nService.t('localInferenceInspectorConfiguredContext'),
      value:
        formatModelInspectorContext(preference?.ctxSize) ??
        formatModelInspectorContext(serviceConfig.ctxSize ? Number(serviceConfig.ctxSize) : undefined) ??
        i18nService.t('localInferenceInspectorDefault'),
    },
  ];
}

function getFixedParameterRows(
  preference: LlamaCppModelPreference | undefined,
  serviceConfig: LlamaCppServiceConfig,
): InspectorRow[] {
  return [
    {
      label: i18nService.t('localInferenceInspectorEstimatedVram'),
      value: i18nService.t('localInferenceInspectorUnavailable'),
    },
    {
      label: i18nService.t('localInferenceInspectorEstimatedMemory'),
      value: i18nService.t('localInferenceInspectorUnavailable'),
    },
    {
      label: i18nService.t('localInferenceServiceConfigGpuLayersLabel'),
      value: getServiceConfigValue(serviceConfig.gpuLayers),
    },
    {
      label: i18nService.t('localInferenceServiceConfigThreadsLabel'),
      value: getServiceConfigValue(serviceConfig.threads),
    },
    {
      label: i18nService.t('localInferenceServiceConfigMmapLabel'),
      value: getMmapValue(serviceConfig.noMmap),
    },
    {
      label: i18nService.t('localInferenceInspectorKeepAlive'),
      value: i18nService.t('localInferenceInspectorUnavailable'),
    },
    {
      label: i18nService.t('capabilityToolCalling'),
      value: getCapabilityValue(preference?.capabilities?.toolCalling),
    },
    {
      label: i18nService.t('localInferenceServiceConfigBatchSizeLabel'),
      value: getServiceConfigValue(serviceConfig.batchSize),
    },
    {
      label: i18nService.t('localInferenceServiceConfigTimeoutLabel'),
      value: getServiceConfigValue(serviceConfig.timeout),
    },
  ];
}

function getServiceConfigValue(value?: string): string {
  return value?.trim() || i18nService.t('localInferenceInspectorDefault');
}

function getMmapValue(noMmap?: boolean): string {
  if (noMmap === undefined) return i18nService.t('localInferenceInspectorDefault');
  return noMmap ? i18nService.t('localInferenceInspectorDisabled') : i18nService.t('localInferenceInspectorEnabled');
}

function getCapabilityValue(value?: ModelCapabilityStatus): string {
  switch (value) {
    case ModelCapabilityStatus.Supported:
      return i18nService.t('capabilitySupported');
    case ModelCapabilityStatus.Unsupported:
      return i18nService.t('capabilityUnsupported');
    default:
      return i18nService.t('capabilityUnknown');
  }
}
