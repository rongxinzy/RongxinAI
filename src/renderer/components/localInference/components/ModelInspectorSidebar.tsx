import { Button } from '@shared/components/ui/button';
import { FluidTabs, FluidTabsSize } from '@shared/components/ui/fluid-tabs';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { cn } from '@shared/lib/utils';
import { X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type TransitionEvent as ReactTransitionEvent,
} from 'react';

import type {
  LlamaCppModel,
  LlamaCppModelPreference,
  LlamaCppRunningModel,
  LlamaCppServiceConfig,
} from '../../../../shared/llamacpp';
import {
  estimateLlamaCppModelMemory,
  LLAMACPP_MEMORY_ESTIMATE_MIB,
  LlamaCppModelResidencyMode,
} from '../../../../shared/llamacpp';
import { ModelCapabilityStatus } from '../../../../shared/providers';
import { i18nService } from '../../../services/i18n';
import { LOCAL_INFERENCE_MODEL_LAUNCH_LOG_TRANSITION_MS } from '../constants';
import { formatBytes } from '../utils/progress';
import {
  ContextSizeControl,
  formatContextKInput,
  getContextPresets,
  getCustomContextError,
  getInitialContextValue,
  ModelContextEditorMode,
  ModelContextSettingsModal,
  ModelContextSettingsPresentation,
  parseCustomContextValue,
  type ModelContextEditorState,
} from './ModelContextSettingsModal';
import { ModelInspectorLogsPanel } from './ModelInspectorLogsPanel';
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

const InspectorRowId = {
  ConfiguredContext: 'configured-context',
  KeepAlive: 'keep-alive',
} as const;
type InspectorRowId = (typeof InspectorRowId)[keyof typeof InspectorRowId];

const ModelResidencySelectValue = {
  FiveMinutes: '5',
  ThirtyMinutes: '30',
  OneHour: '60',
  Forever: 'forever',
} as const;
type ModelResidencySelectValue =
  (typeof ModelResidencySelectValue)[keyof typeof ModelResidencySelectValue];

type ModelResidency = NonNullable<LlamaCppModelPreference['residency']>;

type ModelInspectorSaveInput = {
  ctxSize?: number;
  residency?: ModelResidency;
};

type ModelInspectorSidebarProps = {
  open: boolean;
  model: LlamaCppModel | null;
  runningModel?: LlamaCppRunningModel;
  preference?: LlamaCppModelPreference;
  serviceConfig: LlamaCppServiceConfig;
  initialTab?: ModelInspectorTab;
  onOpenChange: (open: boolean) => void;
  onSavePreferences: (input: ModelInspectorSaveInput) => Promise<boolean>;
  onValidationError: (message: string) => void;
};

type InspectorRow = {
  id?: InspectorRowId;
  label: string;
  value: string;
  control?: ReactNode;
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
  initialTab = ModelInspectorTab.Overview,
  onOpenChange,
  onSavePreferences,
  onValidationError,
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
  const [contextDraft, setContextDraft] = useState<ModelContextEditorState | null>(null);
  const [residencyDraft, setResidencyDraft] = useState<ModelResidency | null>(null);
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
    setContextDraft(null);
    setResidencyDraft(null);
  }, [model?.name, open]);

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [initialTab, model?.name, open]);

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
      if (event.key === 'Escape') {
        setContextDraft(null);
        setResidencyDraft(null);
        onOpenChange(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenChange, open]);

  if (!isPresent || !activeSnapshot || !inspectedModel) return null;
  const trainedContextLimit =
    inspectedModel.trained_context_length ?? inspectedModel.details?.context_length;
  const contextPresets = getContextPresets(trainedContextLimit);
  const baseContextSize = getInitialContextValue(
    activeSnapshot.preference?.ctxSize,
    activeSnapshot.runningModel?.runtime_context_length ?? activeSnapshot.runningModel?.context_length,
    contextPresets,
    trainedContextLimit,
  );
  const contextEditorState =
    contextDraft ?? {
      contextSize: baseContextSize,
      mode: contextPresets.includes(baseContextSize)
        ? ModelContextEditorMode.Preset
        : ModelContextEditorMode.Custom,
      customContextValue: contextPresets.includes(baseContextSize)
        ? ''
        : formatContextKInput(baseContextSize),
    };
  const contextError =
    contextEditorState.mode === ModelContextEditorMode.Custom
      ? getCustomContextError(
          parseCustomContextValue(contextEditorState.customContextValue),
          contextEditorState.customContextValue,
          trainedContextLimit,
        )
      : null;
  const preferenceWithDraft = {
    ...activeSnapshot.preference,
    ...(contextDraft ? { ctxSize: contextDraft.contextSize } : {}),
    ...(residencyDraft ? { residency: residencyDraft } : {}),
  };
  const overviewRows = getOverviewRows(
    inspectedModel,
    preferenceWithDraft,
    activeSnapshot.serviceConfig,
  );
  const fixedParameterRows = getFixedParameterRows(
    inspectedModel,
    activeSnapshot.runningModel,
    preferenceWithDraft,
    activeSnapshot.serviceConfig,
  );
  const runtimeConfigRows = [
    ...overviewRows.slice(0, 2),
    ...overviewRows.slice(2),
    ...fixedParameterRows.slice(0, 2),
    ...fixedParameterRows.slice(2),
  ].map(row =>
    row.id === InspectorRowId.ConfiguredContext
      ? {
          ...row,
          control: (
            <div className="flex min-w-0 flex-col items-end gap-1">
              <ContextSizeControl
                model={inspectedModel}
                editorState={contextEditorState}
                onEditorStateChange={setContextDraft}
                className="w-28 max-w-full"
              />
              {contextError ? <span className="text-xs text-destructive">{contextError}</span> : null}
            </div>
          ),
        }
      : row.id === InspectorRowId.KeepAlive
      ? {
          ...row,
          control: (
            <ModelResidencySelect
              preference={preferenceWithDraft}
              onChange={setResidencyDraft}
            />
          ),
        }
      : row,
  );
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
            onClick={() => {
              setContextDraft(null);
              setResidencyDraft(null);
              onOpenChange(false);
            }}
          >
            <X />
          </Button>
        </header>
        <div
          className={cn(
            'min-h-0 flex-1 px-3 py-3',
            activeTab === ModelInspectorTab.Logs
              ? 'flex flex-col overflow-hidden'
              : 'overflow-y-auto',
          )}
        >
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
                savedContextSize={preferenceWithDraft?.ctxSize}
                runningContextSize={
                  activeSnapshot.runningModel?.runtime_context_length ??
                  activeSnapshot.runningModel?.context_length
                }
                hideContextEditor
                onClose={() => {
                  setContextDraft(null);
                  setResidencyDraft(null);
                  onOpenChange(false);
                }}
                onSave={(_ctxSize, _contextChanged) => {
                  if (contextEditorState.mode === ModelContextEditorMode.Custom) {
                    if (!contextEditorState.customContextValue.trim()) {
                      onValidationError(i18nService.t('localInferenceContextInvalid'));
                      return;
                    }
                    if (contextError) {
                      onValidationError(contextError);
                      return;
                    }
                  }
                  void onSavePreferences({
                    ...(contextDraft ? { ctxSize: contextEditorState.contextSize } : {}),
                    ...(residencyDraft ? { residency: residencyDraft } : {}),
                  }).then(saved => {
                    if (saved) {
                      setContextDraft(null);
                      setResidencyDraft(null);
                    }
                  });
                }}
                presentation={ModelContextSettingsPresentation.Inline}
              />
            </div>
          ) : null}

          {activeTab === ModelInspectorTab.Logs ? (
            <ModelInspectorLogsPanel modelName={inspectedModel.name} />
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
              {row.control ?? row.value}
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
      label: i18nService.t('localInferenceStorageUsage'),
      value: model.size ? formatBytes(model.size) : i18nService.t('localInferenceInspectorUnavailable'),
    },
    {
      id: InspectorRowId.ConfiguredContext,
      label: i18nService.t('localInferenceInspectorConfiguredContext'),
      value:
        formatModelInspectorContext(preference?.ctxSize) ??
        formatModelInspectorContext(serviceConfig.ctxSize ? Number(serviceConfig.ctxSize) : undefined) ??
        i18nService.t('localInferenceInspectorDefault'),
    },
  ];
}

function getFixedParameterRows(
  model: LlamaCppModel,
  runningModel: LlamaCppRunningModel | undefined,
  preference: LlamaCppModelPreference | undefined,
  serviceConfig: LlamaCppServiceConfig,
): InspectorRow[] {
  const estimatedMemory = estimateLlamaCppModelMemory({
    modelSizeBytes: model.size,
    contextSize: getEffectiveContextSize(runningModel, preference, serviceConfig),
  });
  const actualVramBytes = runningModel?.size_vram;
  return [
    {
      id: InspectorRowId.KeepAlive,
      label: i18nService.t('localInferenceInspectorKeepAlive'),
      value: formatResidencyValue(preference),
    },
    {
      label: i18nService.t('localInferenceInspectorEstimatedVram'),
      value:
        actualVramBytes && actualVramBytes > 0
          ? formatMemoryValue(actualVramBytes)
          : estimatedMemory
            ? formatMemoryValue(
                estimatedMemory.estimatedVramMiB * LLAMACPP_MEMORY_ESTIMATE_MIB,
              )
            : i18nService.t('localInferenceInspectorUnavailable'),
    },
    {
      label: i18nService.t('localInferenceInspectorEstimatedMemory'),
      value: estimatedMemory
        ? formatMemoryValue(
            estimatedMemory.estimatedSystemMemoryMiB * LLAMACPP_MEMORY_ESTIMATE_MIB,
          )
        : i18nService.t('localInferenceInspectorUnavailable'),
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

function ModelResidencySelect({
  preference,
  onChange,
}: {
  preference: LlamaCppModelPreference | undefined;
  onChange: (residency: ModelResidency) => void;
}) {
  const persistedValue = getModelResidencySelectValue(preference);
  const items = getModelResidencySelectItems();

  return (
    <Select
      items={items}
      value={persistedValue}
      onValueChange={nextValue => {
        if (!nextValue) return;
        const residency = resolveModelResidency(nextValue as ModelResidencySelectValue);
        if (!residency) return;
        onChange(residency);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={i18nService.t('localInferenceInspectorKeepAlive')}
        className="w-28 max-w-full"
      >
        <SelectValue>
          {() => formatResidencyValue(preference)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          <SelectItem value={ModelResidencySelectValue.FiveMinutes}>
            {i18nService.t('localInferenceResidencyFiveMinutes')}
          </SelectItem>
          <SelectItem value={ModelResidencySelectValue.ThirtyMinutes}>
            {i18nService.t('localInferenceResidencyThirtyMinutes')}
          </SelectItem>
          <SelectItem value={ModelResidencySelectValue.OneHour}>
            {i18nService.t('localInferenceResidencyOneHour')}
          </SelectItem>
          <SelectItem value={ModelResidencySelectValue.Forever}>
            {i18nService.t('localInferenceResidencyForever')}
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function getModelResidencySelectItems(): Record<ModelResidencySelectValue, string> {
  return {
    [ModelResidencySelectValue.FiveMinutes]: i18nService.t('localInferenceResidencyFiveMinutes'),
    [ModelResidencySelectValue.ThirtyMinutes]: i18nService.t('localInferenceResidencyThirtyMinutes'),
    [ModelResidencySelectValue.OneHour]: i18nService.t('localInferenceResidencyOneHour'),
    [ModelResidencySelectValue.Forever]: i18nService.t('localInferenceResidencyForever'),
  };
}

function getModelResidencySelectValue(
  preference: LlamaCppModelPreference | undefined,
): ModelResidencySelectValue {
  if (preference?.residency?.mode === LlamaCppModelResidencyMode.Forever) {
    return ModelResidencySelectValue.Forever;
  }
  switch (preference?.residency?.idleMinutes ?? 30) {
    case 5:
      return ModelResidencySelectValue.FiveMinutes;
    case 30:
      return ModelResidencySelectValue.ThirtyMinutes;
    case 60:
      return ModelResidencySelectValue.OneHour;
    default:
      return ModelResidencySelectValue.ThirtyMinutes;
  }
}

function resolveModelResidency(
  value: ModelResidencySelectValue,
): NonNullable<LlamaCppModelPreference['residency']> | null {
  if (value === ModelResidencySelectValue.Forever) {
    return { mode: LlamaCppModelResidencyMode.Forever };
  }
  const minutesByValue = {
    [ModelResidencySelectValue.FiveMinutes]: 5,
    [ModelResidencySelectValue.ThirtyMinutes]: 30,
    [ModelResidencySelectValue.OneHour]: 60,
  } as const;
  const idleMinutes = minutesByValue[value as keyof typeof minutesByValue];
  return idleMinutes === undefined ? null : { mode: LlamaCppModelResidencyMode.Timed, idleMinutes };
}

function formatResidencyValue(preference: LlamaCppModelPreference | undefined): string {
  if (preference?.residency?.mode === LlamaCppModelResidencyMode.Forever) {
    return i18nService.t('localInferenceResidencyForever');
  }
  if (preference?.residency?.idleMinutes === 0) {
    return i18nService.t('localInferenceResidencyImmediate');
  }
  return i18nService
    .t('localInferenceResidencyThirtyMinutes')
    .replace('30', String(preference?.residency?.idleMinutes ?? 30));
}

function getEffectiveContextSize(
  runningModel: LlamaCppRunningModel | undefined,
  preference: LlamaCppModelPreference | undefined,
  serviceConfig: LlamaCppServiceConfig,
): number | undefined {
  return (
    runningModel?.runtime_context_length ??
    runningModel?.context_length ??
    preference?.ctxSize ??
    (serviceConfig.ctxSize ? Number(serviceConfig.ctxSize) : undefined)
  );
}

function formatMemoryValue(valueBytes: number): string {
  return formatBytes(valueBytes);
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
