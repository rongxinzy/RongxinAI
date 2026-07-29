import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Button21st } from '@shared/components/ui/button-21st';
import { Card, CardHeader, CardTitle } from '@shared/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@shared/components/ui/hover-card';
import { Spinner } from '@shared/components/ui/spinner';
import { cn } from '@shared/lib/utils';
import { Box, Play, Settings2, Square } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import {
  type ComponentType,
  type CSSProperties,
  type DragEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  LlamaCppModel,
  LlamaCppModelPreference,
  LlamaCppModelPreferences,
  LlamaCppRunningModel,
} from '../../../../shared/llamacpp';
import { ProviderName } from '../../../../shared/providers';
import clockIconUrl from '../../../assets/localInference/clock.svg';
import logIconUrl from '../../../assets/localInference/log.svg';
import { i18nService } from '../../../services/i18n';
import {
  AnthropicIcon,
  DeepSeekIcon,
  GeminiIcon,
  MiniMaxIcon,
  MoonshotIcon,
  OpenAIIcon,
  QianfanIcon,
  QwenIcon,
  StepfunIcon,
  VolcengineIcon,
  XiaomiIcon,
  ZhipuIcon,
} from '../../icons/providers';
import {
  LOCAL_INFERENCE_MODEL_LAUNCH_LOG_TRANSITION_MS,
  localInferenceMutedTextClass,
} from '../constants';
import {
  readLocalModelOrder,
  reconcileLocalModelOrder,
  reorderLocalModelOrder,
  writeLocalModelOrder,
} from '../utils/modelOrder';
import { ListPagination } from '../../common/ListPagination';
import { type LocalModelProvider, resolveLocalModelProvider } from '../utils/modelProvider';
import { formatBytes, formatDate } from '../utils/progress';

const modelProviderIconMap = {
  [ProviderName.Anthropic]: AnthropicIcon,
  [ProviderName.DeepSeek]: DeepSeekIcon,
  [ProviderName.Gemini]: GeminiIcon,
  [ProviderName.Minimax]: MiniMaxIcon,
  [ProviderName.Moonshot]: MoonshotIcon,
  [ProviderName.OpenAI]: OpenAIIcon,
  [ProviderName.Qianfan]: QianfanIcon,
  [ProviderName.Qwen]: QwenIcon,
  [ProviderName.StepFun]: StepfunIcon,
  [ProviderName.Volcengine]: VolcengineIcon,
  [ProviderName.Xiaomi]: XiaomiIcon,
  [ProviderName.Zhipu]: ZhipuIcon,
} satisfies Record<LocalModelProvider, ComponentType<{ className?: string }>>;

const MODEL_CARD_MAX_VISIBLE_TAGS = 6;
const MODEL_PAGE_SIZE_WITHOUT_LOG = 16;
const MODEL_PAGE_SIZE_WITH_LOG = 8;
const MODEL_PAGE_SIZE_WITH_SINGLE_COLUMN_LOG = 4;
const MODEL_PAGE_GRID_COLUMNS_WITH_LOG = 2;
const MODEL_PAGE_GRID_COLUMNS_WITH_SINGLE_COLUMN_LOG = 1;
const MODEL_PAGE_GRID_COLUMNS_WIDE = 4;
const MODEL_CARD_MIN_WIDTH = 280;
const MODEL_GRID_COLUMN_GAP = 12;
const MODEL_GRID_TWO_COLUMN_MIN_WIDTH = MODEL_CARD_MIN_WIDTH * 2 + MODEL_GRID_COLUMN_GAP;
const MODEL_CARD_LAYOUT_TRANSITION_SECONDS =
  LOCAL_INFERENCE_MODEL_LAUNCH_LOG_TRANSITION_MS / 1000;
const modelCardActionClassName =
  'relative z-20 transition-[opacity,transform] duration-200 ease-out group-hover/card:translate-x-0 group-hover/card:opacity-100 group-hover/card:pointer-events-auto';
const modelCardHiddenActionClassName = 'pointer-events-none translate-x-1 opacity-0';
type ModelCardTag = {
  label: string;
};

const modelCardTagBaseClassName = 'h-6 rounded-md px-2 py-0 text-xs font-normal shadow-none';

type ModelsPanelProps = {
  loading: boolean;
  loadingModelName: string | null;
  unloadingModelName: string | null;
  localModels: LlamaCppModel[];
  runningModels: LlamaCppRunningModel[];
  modelPreferences: LlamaCppModelPreferences;
  onLoadModel: (model: LlamaCppModel) => void;
  onUnload: (modelName: string) => void;
  onDelete: (modelName: string) => void;
  onConfigureContext: (model: LlamaCppModel) => void;
  onOpenLaunchLog?: (modelName: string) => void;
  renderLoadButton?: (
    model: LlamaCppModel,
    props: { disabled: boolean; onClick: () => void },
  ) => React.ReactNode;
  showRegisteredModelsTitle?: boolean;
  logPanelVisible?: boolean;
  logPanelModelName?: string | null;
};

type ModelCardProps = {
  model: LlamaCppModel;
  runningModel?: LlamaCppRunningModel;
  preference?: LlamaCppModelPreference;
  loading: boolean;
  loadingModel: boolean;
  unloading: boolean;
  onLoadModel: () => void;
  onConfigureContext: () => void;
  onUnload: () => void;
  dragging: boolean;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  renderLoadButton?: (props: { disabled: boolean; onClick: () => void }) => React.ReactNode;
  onOpenLaunchLog: (modelName: string) => void;
  frozenWidth?: number | null;
  transitionOffset?: ModelCardTransitionOffset | null;
};

type ModelCardEntry = {
  model: LlamaCppModel;
  runningModel?: LlamaCppRunningModel;
};

type FrozenModelCardLayout = {
  id: number;
  width: number;
  height: number;
  columnGap: number;
  rowGap: number;
  sourceColumns: number;
  targetColumns: number;
};

type ModelCardTransitionOffset = {
  x: number;
  y: number;
};

export function ModelsPanel({
  loading,
  loadingModelName,
  unloadingModelName,
  localModels,
  runningModels,
  modelPreferences,
  onLoadModel,
  onUnload,
  onDelete,
  onConfigureContext,
  onOpenLaunchLog,
  renderLoadButton,
  showRegisteredModelsTitle = true,
  logPanelVisible = false,
  logPanelModelName = null,
}: ModelsPanelProps) {
  const [pendingDeleteModel, setPendingDeleteModel] = useState<LlamaCppModel | null>(null);
  const [modelOrder, setModelOrder] = useState<string[]>(readLocalModelOrder);
  const [draggedModelName, setDraggedModelName] = useState<string | null>(null);
  const [modelPage, setModelPage] = useState(1);
  const [logPanelLayoutVisible, setLogPanelLayoutVisible] = useState(logPanelVisible);
  const [logPanelGridColumns, setLogPanelGridColumns] = useState(MODEL_PAGE_GRID_COLUMNS_WITH_LOG);
  const [modelGridWidth, setModelGridWidth] = useState(0);
  const [frozenLayout, setFrozenLayout] = useState<FrozenModelCardLayout | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const previousLogPanelVisibleRef = useRef(logPanelVisible);
  const previousModelsPerPageRef = useRef<number | null>(null);
  const modelCardTransitionIdRef = useRef(0);
  const latestGridLayoutRef = useRef<Pick<
    FrozenModelCardLayout,
    'width' | 'height' | 'columnGap' | 'rowGap' | 'sourceColumns'
  > | null>(null);
  const availableModels = useMemo(
    () => mergeVisibleModels(localModels, runningModels),
    [localModels, runningModels],
  );
  const availableModelNames = useMemo(
    () => availableModels.map(model => model.name),
    [availableModels],
  );
  const orderedModelNames = useMemo(
    () => reconcileLocalModelOrder(availableModelNames, modelOrder),
    [availableModelNames, modelOrder],
  );
  const modelCards = useMemo<ModelCardEntry[]>(() => {
    const modelsByName = new Map(availableModels.map(model => [model.name, model]));
    return orderedModelNames.flatMap(name => {
      const model = modelsByName.get(name);
      return model ? [{ model, runningModel: findRunningModel(runningModels, model.name) }] : [];
    });
  }, [availableModels, orderedModelNames, runningModels]);
  const modelsPerPage = logPanelLayoutVisible
    ? logPanelGridColumns === MODEL_PAGE_GRID_COLUMNS_WITH_SINGLE_COLUMN_LOG
      ? MODEL_PAGE_SIZE_WITH_SINGLE_COLUMN_LOG
      : MODEL_PAGE_SIZE_WITH_LOG
    : MODEL_PAGE_SIZE_WITHOUT_LOG;
  const totalModelPages = Math.max(1, Math.ceil(modelCards.length / modelsPerPage));
  const currentModelPage = Math.min(modelPage, totalModelPages);
  const modelGridClassName = logPanelLayoutVisible
    ? logPanelGridColumns === MODEL_PAGE_GRID_COLUMNS_WITH_SINGLE_COLUMN_LOG
      ? 'grid-cols-1'
      : 'grid-cols-2'
    : 'grid-cols-2 2xl:grid-cols-4';
  const visibleModelCards = modelCards.slice(
    (currentModelPage - 1) * modelsPerPage,
    currentModelPage * modelsPerPage,
  );

  useLayoutEffect(() => {
    if (previousLogPanelVisibleRef.current === logPanelVisible) return undefined;

    const measuredLayout = latestGridLayoutRef.current ?? measureModelGridLayout(gridRef.current);
    previousLogPanelVisibleRef.current = logPanelVisible;

    if (measuredLayout) {
      modelCardTransitionIdRef.current += 1;
      const targetColumns = getTargetModelGridColumns(
        logPanelVisible,
        measuredLayout.sourceColumns,
      );
      setFrozenLayout({
        id: modelCardTransitionIdRef.current,
        ...measuredLayout,
        targetColumns,
      });
      setLogPanelGridColumns(targetColumns);
    }
    setLogPanelLayoutVisible(logPanelVisible);

    const timeout = window.setTimeout(() => {
      setFrozenLayout(null);
      const nextLayout = measureModelGridLayout(gridRef.current);
      if (nextLayout) latestGridLayoutRef.current = nextLayout;
    }, LOCAL_INFERENCE_MODEL_LAUNCH_LOG_TRANSITION_MS);

    return () => window.clearTimeout(timeout);
  }, [logPanelVisible]);

  useLayoutEffect(() => {
    if (frozenLayout !== null) return;

    const measuredLayout = measureModelGridLayout(gridRef.current);
    if (measuredLayout) latestGridLayoutRef.current = measuredLayout;
  });

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const updateGridWidth = () => {
      const width = Math.round(grid.getBoundingClientRect().width);
      setModelGridWidth(currentWidth => (currentWidth === width ? currentWidth : width));
    };
    updateGridWidth();

    if (typeof ResizeObserver === 'undefined') return;
    const resizeObserver = new ResizeObserver(updateGridWidth);
    resizeObserver.observe(grid);
    return () => resizeObserver.disconnect();
  }, [modelCards.length]);

  useEffect(() => {
    if (!logPanelLayoutVisible || modelGridWidth <= 0 || frozenLayout !== null) return;

    const targetColumns = getResponsiveLogPanelGridColumns(modelGridWidth);
    if (targetColumns !== logPanelGridColumns) setLogPanelGridColumns(targetColumns);
  }, [frozenLayout, logPanelGridColumns, logPanelLayoutVisible, modelGridWidth]);

  useEffect(() => {
    const previousModelsPerPage = previousModelsPerPageRef.current;
    if (previousModelsPerPage === modelsPerPage) return;
    previousModelsPerPageRef.current = modelsPerPage;
    const anchorIndex = logPanelModelName
      ? modelCards.findIndex(({ model }) => model.name === logPanelModelName)
      : -1;
    if (anchorIndex >= 0) {
      setModelPage(Math.floor(anchorIndex / modelsPerPage) + 1);
      return;
    }
    setModelPage(currentPage => Math.min(currentPage, totalModelPages));
  }, [logPanelModelName, modelCards, modelsPerPage, totalModelPages]);

  useEffect(() => {
    if (modelPage > totalModelPages) setModelPage(totalModelPages);
  }, [modelPage, totalModelPages]);

  useEffect(() => {
    setModelOrder(currentOrder => {
      const nextOrder = reconcileLocalModelOrder(availableModelNames, currentOrder);
      if (sameModelOrder(currentOrder, nextOrder)) return currentOrder;
      writeLocalModelOrder(nextOrder);
      return nextOrder;
    });
  }, [availableModelNames]);

  const pendingDeleteRunningModel = pendingDeleteModel
    ? findRunningModel(runningModels, pendingDeleteModel.name)
    : undefined;
  const pendingDeleteDisplayName = pendingDeleteModel
    ? getModelDisplayName(pendingDeleteModel.name)
    : '';
  const pendingDeleteBusy =
    loading || (!!pendingDeleteModel && unloadingModelName === pendingDeleteModel.name);

  const handleCardDragStart = (event: DragEvent<HTMLDivElement>, modelName: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', modelName);
    setDraggedModelName(modelName);
  };

  const handleCardDrop = (event: DragEvent<HTMLDivElement>, targetModelName: string) => {
    event.preventDefault();
    const sourceModelName = event.dataTransfer.getData('text/plain') || draggedModelName;
    if (sourceModelName) {
      setModelOrder(currentOrder => {
        const currentVisibleOrder = reconcileLocalModelOrder(availableModelNames, currentOrder);
        const nextOrder = reorderLocalModelOrder(
          currentVisibleOrder,
          sourceModelName,
          targetModelName,
        );
        writeLocalModelOrder(nextOrder);
        return nextOrder;
      });
    }
    setDraggedModelName(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        {showRegisteredModelsTitle ? (
          <h2 className="text-sm font-semibold text-foreground">
            {i18nService.t('localInferenceRegisteredModels')}
          </h2>
        ) : null}
        {modelCards.length > 0 ? (
          <>
            <div
              ref={gridRef}
              className={cn(
                'grid w-full auto-rows-min content-start gap-3',
                frozenLayout ? 'justify-start' : modelGridClassName,
              )}
              style={getFrozenModelGridStyle(frozenLayout)}
            >
              {visibleModelCards.map(({ model, runningModel }, index) => (
                <ModelCard
                  key={frozenLayout ? `${model.name}:${frozenLayout.id}` : model.name}
                  model={model}
                  runningModel={runningModel}
                  preference={modelPreferences[model.name]}
                  loading={loading}
                  loadingModel={loadingModelName === model.name}
                  unloading={unloadingModelName === model.name}
                  onLoadModel={() => onLoadModel(model)}
                  onConfigureContext={() => onConfigureContext(model)}
                  onUnload={() => onUnload(model.name)}
                  dragging={draggedModelName === model.name}
                  onDragStart={event => handleCardDragStart(event, model.name)}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => handleCardDrop(event, model.name)}
                  onDragEnd={() => setDraggedModelName(null)}
                  renderLoadButton={
                    renderLoadButton ? props => renderLoadButton(model, props) : undefined
                  }
                  onOpenLaunchLog={onOpenLaunchLog ?? (() => undefined)}
                  frozenWidth={frozenLayout?.width}
                  transitionOffset={getModelCardTransitionOffset(index, frozenLayout)}
                />
              ))}
            </div>
            <ListPagination
              page={currentModelPage}
              totalPages={totalModelPages}
              onPageChange={setModelPage}
              className="pt-1"
            />
          </>
        ) : null}
      </section>

      <Dialog
        open={Boolean(pendingDeleteModel)}
        onOpenChange={open => {
          if (!open) setPendingDeleteModel(null);
        }}
      >
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{i18nService.t('confirmDelete')}</DialogTitle>
            <DialogDescription>
              {pendingDeleteRunningModel
                ? i18nService.t('localInferenceDeleteRunningBlocked')
                : i18nService
                    .t('localInferenceDeleteConfirmMessage')
                    .replace('{name}', pendingDeleteDisplayName)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDeleteModel(null)}>
              {i18nService.t('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pendingDeleteBusy || Boolean(pendingDeleteRunningModel)}
              onClick={() => {
                if (!pendingDeleteModel || pendingDeleteRunningModel) return;
                setPendingDeleteModel(null);
                onDelete(pendingDeleteModel.name);
              }}
            >
              {i18nService.t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getFrozenModelGridStyle(
  layout: FrozenModelCardLayout | null,
): CSSProperties | undefined {
  if (!layout) return undefined;

  return {
    gridTemplateColumns: `repeat(${layout.targetColumns}, ${layout.width}px)`,
  };
}

function getModelCardTransitionOffset(
  index: number,
  layout: FrozenModelCardLayout | null,
): ModelCardTransitionOffset | null {
  if (!layout) return null;

  const sourcePosition = getModelCardGridPosition(index, layout.sourceColumns);
  const targetPosition = getModelCardGridPosition(index, layout.targetColumns);
  const x = (sourcePosition.column - targetPosition.column) * (layout.width + layout.columnGap);
  const y = (sourcePosition.row - targetPosition.row) * (layout.height + layout.rowGap);

  if (x === 0 && y === 0) return null;
  return { x, y };
}

function getModelCardGridPosition(index: number, columns: number): { column: number; row: number } {
  const normalizedColumns = Math.max(1, columns);
  return {
    column: index % normalizedColumns,
    row: Math.floor(index / normalizedColumns),
  };
}
function getResponsiveLogPanelGridColumns(width: number): number {
  return width >= MODEL_GRID_TWO_COLUMN_MIN_WIDTH
    ? MODEL_PAGE_GRID_COLUMNS_WITH_LOG
    : MODEL_PAGE_GRID_COLUMNS_WITH_SINGLE_COLUMN_LOG;
}

function getTargetModelGridColumns(logPanelVisible: boolean, sourceColumns?: number): number {
  if (logPanelVisible) {
    return Math.max(
      MODEL_PAGE_GRID_COLUMNS_WITH_SINGLE_COLUMN_LOG,
      Math.floor((sourceColumns ?? MODEL_PAGE_GRID_COLUMNS_WITH_LOG) / 2),
    );
  }
  return window.matchMedia('(min-width: 1536px)').matches
    ? MODEL_PAGE_GRID_COLUMNS_WIDE
    : MODEL_PAGE_GRID_COLUMNS_WITH_LOG;
}

function measureModelGridLayout(
  grid: HTMLDivElement | null,
): Pick<FrozenModelCardLayout, 'width' | 'height' | 'columnGap' | 'rowGap' | 'sourceColumns'> | null {
  const firstCard = grid?.querySelector<HTMLElement>(
    '[data-local-inference-model-card-frame="true"]',
  );
  if (!grid || !firstCard) return null;

  const cardRect = firstCard.getBoundingClientRect();
  const gridStyle = window.getComputedStyle(grid);
  const sourceColumns = gridStyle.gridTemplateColumns
    .split(' ')
    .filter(Boolean)
    .length;
  return {
    width: cardRect.width,
    height: cardRect.height,
    columnGap: parseCssPixelValue(gridStyle.columnGap),
    rowGap: parseCssPixelValue(gridStyle.rowGap),
    sourceColumns: Math.max(1, sourceColumns),
  };
}

function parseCssPixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ModelCard({
  model,
  runningModel,
  preference,
  loading,
  loadingModel,
  unloading,
  onLoadModel,
  onConfigureContext,
  onUnload,
  dragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  renderLoadButton,
  onOpenLaunchLog,
  frozenWidth,
  transitionOffset,
}: ModelCardProps) {
  const isRunning = Boolean(runningModel);
  const reduceMotion = useReducedMotion();
  const layoutTransition = reduceMotion
    ? { duration: 0 }
    : {
        duration: MODEL_CARD_LAYOUT_TRANSITION_SECONDS,
        ease: [0.4, 0, 0.2, 1] as const,
      };
  const hoverTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const };
  const buttonsDisabled = loading || unloading;
  const displayName = getModelDisplayName(model.name);
  const provider = resolveLocalModelProvider(model);
  const ProviderIcon = provider ? modelProviderIconMap[provider] : Box;
  const quantization = model.details?.quantization_level?.trim();
  const contextValue = getPreferredContext(model, runningModel, preference);
  const details = getModelDetails(model, quantization);
  const hasDetailsTag = details.length > 0;
  const visibleTags = getModelCardTags(model, contextValue, quantization).slice(
    0,
    hasDetailsTag ? MODEL_CARD_MAX_VISIBLE_TAGS - 1 : MODEL_CARD_MAX_VISIBLE_TAGS,
  );
  const modifiedDate = model.modified_at ? formatModelCardDate(model.modified_at) : null;
  const handleOpenLaunchLog = () => {
    onOpenLaunchLog(model.name);
  };

  return (
    <motion.div
      data-local-inference-model-card-frame="true"
      className={cn(
        'relative h-full w-full transform-gpu',
        transitionOffset && 'will-change-transform',
      )}
      initial={transitionOffset ?? { x: 0, y: 0 }}
      animate={{ x: 0, y: 0 }}
      style={frozenWidth ? { width: frozenWidth } : undefined}
      whileHover={
        reduceMotion || loadingModel || unloading || dragging
          ? undefined
          : { scale: 1.02, zIndex: 1 }
      }
      transition={{ x: layoutTransition, y: layoutTransition, scale: hoverTransition }}
    >
      <Card
        size="sm"
        draggable={!loadingModel && !unloading}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        className={cn(
          'relative h-full w-full cursor-grab select-none border border-border/70 bg-card p-0 shadow-sm ring-0 transition-[background-color,border-color,box-shadow] duration-200 active:cursor-grabbing',
          'hover:border-border hover:bg-muted/20 hover:shadow-md',
          (loadingModel || unloading) && 'bg-muted/30',
          dragging && 'opacity-50',
        )}
      >
        <div className={cn('absolute inset-x-0 top-0 h-0.5 bg-transparent')} />
        {isRunning ? (
          <span
            aria-label={i18nService.t('localInferenceStatus_running')}
            className="absolute right-3 top-3 size-2 rounded-full bg-(--zy-success) animate-pulse"
          />
        ) : null}
        {loadingModel || unloading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-xl bg-[color:color-mix(in_srgb,var(--zy-background)_84%,transparent)] backdrop-blur-[1px]">
            <Button21st
              type="button"
              isDisabled
              size="default"
              variant={unloading ? 'closing' : 'loading'}
              data-local-inference-unload-button={unloading ? 'true' : undefined}
            >
              <Spinner
                aria-label={i18nService.t(
                  unloading ? 'localInferenceModelClosing' : 'localInferenceModelLoading',
                )}
                data-icon="inline-start"
                className="[animation-duration:2s]"
              />
              <span>
                {i18nService.t(
                  unloading ? 'localInferenceModelClosing' : 'localInferenceModelLoading',
                )}
              </span>
            </Button21st>
            {loadingModel ? (
              <Button21st
                type="button"
                size="default"
                variant="primary"
                onClick={handleOpenLaunchLog}
              >
                <LogButtonIcon />
                {i18nService.t('localInferenceModelLaunchLogAction')}
              </Button21st>
            ) : null}
          </div>
        ) : null}

        <CardHeader className="relative grid grid-cols-1 grid-rows-[auto_auto_auto] gap-y-1 p-4">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
            >
              <ProviderIcon className="size-5" />
            </span>
            <CardTitle className="truncate text-base font-semibold leading-6 text-foreground">
              {displayName}
            </CardTitle>
          </div>

          <div className="flex items-center gap-2">
            {modifiedDate ? (
              <div className="flex items-center gap-1 text-xs leading-4 text-muted-foreground">
                <img src={clockIconUrl} alt="" aria-hidden="true" className="size-3.5 shrink-0" />
                <span>{modifiedDate}</span>
              </div>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={buttonsDisabled}
              onClick={onConfigureContext}
            >
              <Settings2 data-icon="inline-start" />
              {i18nService.t('localInferenceConfigureContext')}
            </Button>
          </div>

          <div className="flex min-w-0 flex-nowrap items-center gap-1.5 whitespace-nowrap">
            {hasDetailsTag ? (
              <HoverCard>
                <HoverCardTrigger
                  delay={200}
                  closeDelay={100}
                  render={
                    <Badge
                      variant="secondary"
                      className={cn(modelCardTagBaseClassName, 'shrink-0 cursor-default')}
                    >
                      {i18nService.t('localInferenceDetails')}
                    </Badge>
                  }
                />
                <HoverCardContent side="right" align="start" className="w-auto min-w-52 p-3">
                  <div className="flex flex-col gap-2">
                    {details.map(item => (
                      <MetadataRow key={item.label} label={item.label} value={item.value} />
                    ))}
                  </div>
                </HoverCardContent>
              </HoverCard>
            ) : null}
            {visibleTags.map(tag => (
              <Badge
                key={tag.label}
                variant="secondary"
                className={cn(modelCardTagBaseClassName, 'shrink-0')}
              >
                {tag.label}
              </Badge>
            ))}
          </div>

          <div
            className={cn(
              modelCardActionClassName,
              !isRunning && modelCardHiddenActionClassName,
              'absolute bottom-4 right-4',
            )}
          >
            {isRunning ? (
              <Button21st
                type="button"
                variant="danger"
                size="sm"
                isDisabled={buttonsDisabled}
                data-local-inference-model-action-button="true"
                data-local-inference-unload-button="true"
                onClick={onUnload}
              >
                <Square data-icon="inline-start" />
                {i18nService.t('close')}
              </Button21st>
            ) : renderLoadButton ? (
              renderLoadButton({ disabled: buttonsDisabled, onClick: onLoadModel })
            ) : (
              <Button21st
                type="button"
                size="sm"
                isDisabled={buttonsDisabled}
                data-local-inference-model-action-button="true"
                onClick={onLoadModel}
              >
                <Play data-icon="inline-start" />
                {i18nService.t('start')}
              </Button21st>
            )}
          </div>
        </CardHeader>
      </Card>
    </motion.div>
  );
}

function LogButtonIcon() {
  return (
    <img
      src={logIconUrl}
      alt=""
      aria-hidden="true"
      data-icon="inline-start"
      className="size-3.5 shrink-0"
    />
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[68px_minmax(0,1fr)] items-start gap-2.5">
      <div className={cn('pt-0.5 text-[11px] font-medium leading-4', localInferenceMutedTextClass)}>
        {label}
      </div>
      <div className="min-w-0 text-[13px] font-medium leading-5 text-foreground">
        <span className="block break-all">{value}</span>
      </div>
    </div>
  );
}

function getModelDetails(
  model: LlamaCppModel,
  quantization?: string,
): Array<{ label: string; value: string }> {
  const format = formatModelFormatTag(model.details?.format);

  return [
    quantization
      ? {
          label: i18nService.t('localInferenceQuantization'),
          value: quantization,
        }
      : null,
    format
      ? {
          label: i18nService.t('marketplaceFormatLabel'),
          value: format,
        }
      : null,
    model.size
      ? {
          label: i18nService.t('localInferenceSize'),
          value: formatBytes(model.size),
        }
      : null,
    model.modified_at
      ? {
          label: i18nService.t('localInferenceModified'),
          value: formatModelCardDate(model.modified_at),
        }
      : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));
}

function getModelCardTags(
  model: LlamaCppModel,
  contextValue?: number,
  quantization?: string,
): ModelCardTag[] {
  return dedupeModelTags([
    createModelCardTag(formatModelFamilyTag(model.details?.family)),
    createModelCardTag(formatModelTagValue(model.details?.parameter_size)),
    createModelCardTag(formatModelTagValue(quantization)),
    createModelCardTag(
      contextValue
        ? `${formatContextValue(contextValue)} ${i18nService.t('localInferenceContextShort')}`
        : null,
    ),
  ]);
}

function createModelCardTag(label: string | null): ModelCardTag | null {
  return label ? { label } : null;
}

function formatModelFamilyTag(value?: string): string | null {
  const normalized = formatModelTagValue(value);
  if (!normalized) return null;
  return normalized
    .split(/[-_\s]+/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatModelFormatTag(value?: string): string | null {
  const normalized = formatModelTagValue(value);
  return normalized ? normalized.toUpperCase() : null;
}

function formatModelTagValue(value?: string): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function dedupeModelTags(values: Array<ModelCardTag | null>): ModelCardTag[] {
  const seen = new Set<string>();
  return values.filter((value): value is ModelCardTag => {
    if (!value) return false;
    const key = value.label.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getModelDisplayName(name: string): string {
  return name
    .replace(/\.gguf$/i, '')
    .replace(/[-_.\s]?gguf$/i, '')
    .trim();
}

function findRunningModel(
  runningModels: LlamaCppRunningModel[],
  modelName: string,
): LlamaCppRunningModel | undefined {
  return runningModels.find(item => matchesModelName(item, modelName));
}

function mergeVisibleModels(
  localModels: LlamaCppModel[],
  runningModels: LlamaCppRunningModel[],
): LlamaCppModel[] {
  const modelsByName = new Map(localModels.map(model => [model.name, model]));
  for (const runningModel of runningModels) {
    const modelName = runningModel.name || runningModel.model || '';
    if (!modelName || localModels.some(model => matchesModelName(model, modelName))) continue;
    modelsByName.set(modelName, toModelCardModel(runningModel));
  }
  return Array.from(modelsByName.values());
}

function sameModelOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function matchesModelName(
  model: Pick<LlamaCppModel, 'name' | 'model'>,
  modelName: string,
): boolean {
  return model.name === modelName || model.model === modelName;
}

function toModelCardModel(runningModel: LlamaCppRunningModel): LlamaCppModel {
  return {
    ...runningModel,
    name: runningModel.name || runningModel.model || 'unknown',
    id: runningModel.id || runningModel.name || runningModel.model || 'unknown',
    model: runningModel.model || runningModel.name || 'unknown',
  };
}

function getPreferredContext(
  model: LlamaCppModel,
  runningModel?: LlamaCppRunningModel,
  preference?: LlamaCppModelPreference,
): number | undefined {
  return (
    runningModel?.runtime_context_length ??
    preference?.ctxSize ??
    model.runtime_context_length ??
    model.trained_context_length ??
    model.details?.context_length
  );
}

function formatContextValue(value: number): string {
  if (value >= 1024) {
    const normalized = value / 1024;
    const display = Number.isInteger(normalized) ? normalized.toString() : normalized.toFixed(1);
    return `${display}K`;
  }
  return String(value);
}

function formatModelCardDate(value: string): string {
  const isoDateMatch = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (isoDateMatch) return isoDateMatch[0];

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
