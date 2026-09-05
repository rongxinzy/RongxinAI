import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Card, CardHeader, CardTitle } from '@shared/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import {
  Empty,
  EmptyDescription,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/components/ui/empty';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@shared/components/ui/hover-card';
import { Spinner } from '@shared/components/ui/spinner';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { cn } from '@shared/lib/utils';
import { ArrowRight, Box, Clock3, Ellipsis, ScrollText, Settings2, Trash2 } from 'lucide-react';
import {
  type ComponentType,
  type DragEvent,
  memo,
  useCallback,
  useEffect,
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
import { i18nService } from '../../../services/i18n';
import { BreathingDot } from '../components/BreathingDot';
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
import { localInferenceMutedTextClass } from '../constants';
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
const MODEL_CARD_MIN_WIDTH = 280;
const MODEL_GRID_COLUMN_GAP = 12;
const MODEL_GRID_TWO_COLUMN_MIN_WIDTH = MODEL_CARD_MIN_WIDTH * 2 + MODEL_GRID_COLUMN_GAP;
type ModelCardTag = {
  label: string;
};

const modelCardTagBaseClassName = 'h-6 rounded-md px-2 py-0 text-xs font-normal shadow-none';

function preventModelCardDragOver(event: DragEvent<HTMLDivElement>) {
  event.preventDefault();
}

function noopOpenLaunchLog() {
  // Launch log panel is optional; some hosts do not provide one.
}

type ModelsPanelProps = {
  loading: boolean;
  loadingModelName: string | null;
  cancellingModelLoad: boolean;
  unloadingModelName: string | null;
  localModels: LlamaCppModel[];
  runningModels: LlamaCppRunningModel[];
  modelPreferences: LlamaCppModelPreferences;
  onLoadModel: (model: LlamaCppModel) => void;
  onCancelModelLoad: (modelName: string) => void;
  onUnload: (modelName: string) => void;
  onDelete: (modelName: string) => void;
  onConfigureContext: (model: LlamaCppModel) => void;
  onOpenMarketplace?: () => void;
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
  cancellingModelLoad: boolean;
  unloading: boolean;
  onLoadModel: (model: LlamaCppModel) => void;
  onCancelModelLoad: (modelName: string) => void;
  onConfigureContext: (model: LlamaCppModel) => void;
  onUnload: (modelName: string) => void;
  onDelete: (model: LlamaCppModel) => void;
  dragging: boolean;
  onDragStart: (event: DragEvent<HTMLDivElement>, modelName: string) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, modelName: string) => void;
  onDragEnd: () => void;
  renderLoadButton?: (
    model: LlamaCppModel,
    props: { disabled: boolean; onClick: () => void },
  ) => React.ReactNode;
  onOpenLaunchLog: (modelName: string) => void;
};

type ModelCardEntry = {
  model: LlamaCppModel;
  runningModel?: LlamaCppRunningModel;
};

export function ModelsPanel({
  loading,
  loadingModelName,
  cancellingModelLoad,
  unloadingModelName,
  localModels,
  runningModels,
  modelPreferences,
  onLoadModel,
  onCancelModelLoad,
  onUnload,
  onDelete,
  onConfigureContext,
  onOpenMarketplace,
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
  const logPanelLayoutVisible = logPanelVisible;
  const [logPanelGridColumns, setLogPanelGridColumns] = useState(MODEL_PAGE_GRID_COLUMNS_WITH_LOG);
  const [modelGridWidth, setModelGridWidth] = useState(0);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const previousModelsPerPageRef = useRef<number | null>(null);
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
  const modelGridClassName =
    logPanelLayoutVisible && logPanelGridColumns === MODEL_PAGE_GRID_COLUMNS_WITH_SINGLE_COLUMN_LOG
      ? 'grid-cols-1 mx-auto w-full max-w-5xl'
      : 'grid-cols-2 mx-auto w-full max-w-5xl';
  const visibleModelCards = modelCards.slice(
    (currentModelPage - 1) * modelsPerPage,
    currentModelPage * modelsPerPage,
  );

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
    if (!logPanelLayoutVisible || modelGridWidth <= 0) return;

    const targetColumns = getResponsiveLogPanelGridColumns(modelGridWidth);
    if (targetColumns !== logPanelGridColumns) setLogPanelGridColumns(targetColumns);
  }, [logPanelGridColumns, logPanelLayoutVisible, modelGridWidth]);

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
  const deleteConfirmationMessage = pendingDeleteRunningModel
    ? i18nService.t('localInferenceDeleteRunningBlocked')
    : i18nService
        .t('localInferenceDeleteConfirmMessage')
        .replace('{name}', pendingDeleteDisplayName);
  const pendingDeleteBusy =
    loading || (!!pendingDeleteModel && unloadingModelName === pendingDeleteModel.name);

  const handleCancelDelete = () => {
    setPendingDeleteModel(null);
  };

  const handleConfirmDelete = () => {
    if (!pendingDeleteModel || pendingDeleteRunningModel) return;

    const modelName = pendingDeleteModel.name;
    setPendingDeleteModel(null);
    onDelete(modelName);
  };

  const handleCardDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, modelName: string) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', modelName);
      setDraggedModelName(modelName);
    },
    [],
  );

  const handleCardDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, targetModelName: string) => {
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
    },
    [availableModelNames, draggedModelName],
  );

  const handleCardDragEnd = useCallback(() => {
    setDraggedModelName(null);
  }, []);

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
              className={cn('grid w-full auto-rows-min content-start gap-3', modelGridClassName)}
            >
              {visibleModelCards.map(({ model, runningModel }) => (
                <ModelCard
                  key={model.name}
                  model={model}
                  runningModel={runningModel}
                  preference={modelPreferences[model.name]}
                  loading={loading}
                  loadingModel={loadingModelName === model.name}
                  cancellingModelLoad={cancellingModelLoad}
                  unloading={unloadingModelName === model.name}
                  onLoadModel={onLoadModel}
                  onCancelModelLoad={onCancelModelLoad}
                  onConfigureContext={onConfigureContext}
                  onUnload={onUnload}
                  onDelete={setPendingDeleteModel}
                  dragging={draggedModelName === model.name}
                  onDragStart={handleCardDragStart}
                  onDragOver={preventModelCardDragOver}
                  onDrop={handleCardDrop}
                  onDragEnd={handleCardDragEnd}
                  renderLoadButton={renderLoadButton}
                  onOpenLaunchLog={onOpenLaunchLog ?? noopOpenLaunchLog}
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
        ) : (
          <Empty className="mx-auto min-h-80 w-full max-w-[800px] rounded-lg border border-dashed border-border bg-card p-6">
            <EmptyMedia
              className="size-12 rounded-lg bg-muted text-muted-foreground"
              variant="icon"
            >
              <Box size={32} className="size-8 text-foreground" />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle className="text-lg font-semibold">
                {i18nService.t('localInferenceLocalModelsEmptyTitle')}
              </EmptyTitle>
              <EmptyDescription>
                {i18nService.t('localInferenceLocalModelsEmptyDescription')}
              </EmptyDescription>
            </EmptyHeader>
            {onOpenMarketplace ? (
              <EmptyContent>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 min-w-28 cursor-pointer px-4 transition-[background-color,border-color] duration-200 ease-out"
                  onClick={onOpenMarketplace}
                >
                  {i18nService.t('localInferenceLocalModelsEmptyAction')}
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        )}
      </section>

      {pendingDeleteModel ? (
        <DestructiveConfirmDialog
          open
          title={i18nService.t('confirmDelete')}
          description={deleteConfirmationMessage}
          cancelLabel={i18nService.t('cancel')}
          confirmLabel={i18nService.t('delete')}
          confirmDisabled={pendingDeleteBusy || Boolean(pendingDeleteRunningModel)}
          onCancel={handleCancelDelete}
          onConfirm={handleConfirmDelete}
        />
      ) : null}
    </div>
  );
}

function getResponsiveLogPanelGridColumns(width: number): number {
  return width >= MODEL_GRID_TWO_COLUMN_MIN_WIDTH
    ? MODEL_PAGE_GRID_COLUMNS_WITH_LOG
    : MODEL_PAGE_GRID_COLUMNS_WITH_SINGLE_COLUMN_LOG;
}

const ModelCard = memo(function ModelCard({
  model,
  runningModel,
  preference,
  loading,
  loadingModel,
  cancellingModelLoad,
  unloading,
  onLoadModel,
  onCancelModelLoad,
  onConfigureContext,
  onUnload,
  onDelete,
  dragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  renderLoadButton,
  onOpenLaunchLog,
}: ModelCardProps) {
  const isRunning = Boolean(runningModel);
  const buttonsDisabled = loading || unloading;
  const displayName = getModelDisplayName(model.name);
  const provider = resolveLocalModelProvider(model);
  const ProviderIcon = provider ? modelProviderIconMap[provider] : Box;
  const quantization = model.details?.quantization_level?.trim();
  const contextValue = getPreferredContext(model, runningModel, preference);
  const details = getModelDetails(model, quantization);
  const hasDetailsTag = details.length > 0;
  const visibleTags = getModelCardTags(contextValue).slice(
    0,
    hasDetailsTag ? MODEL_CARD_MAX_VISIBLE_TAGS - 1 : MODEL_CARD_MAX_VISIBLE_TAGS,
  );
  const modifiedDate = model.modified_at ? formatModelCardDate(model.modified_at) : null;
  const handleLoadModel = () => onLoadModel(model);
  const handleOpenLaunchLog = () => {
    onOpenLaunchLog(model.name);
  };

  return (
    <div
      data-local-inference-model-card-frame="true"
      className="relative z-0 h-full w-full rounded-lg transition-[z-index] duration-200 hover:z-20 focus-within:z-20"
    >
      <Card
        size="sm"
        draggable={!loadingModel && !unloading}
        onDragStart={event => onDragStart(event, model.name)}
        onDragOver={onDragOver}
        onDrop={event => onDrop(event, model.name)}
        onDragEnd={onDragEnd}
        className={cn(
          'relative h-full w-full cursor-grab select-none rounded-lg border border-border/70 bg-card p-0 shadow-sm ring-0 transition-[background-color,border-color] duration-200 active:cursor-grabbing',
          'hover:border-border hover:bg-muted/20',
          (loadingModel || unloading) && 'bg-muted/30',
          dragging && 'opacity-50',
        )}
      >
        {loadingModel || unloading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-lg bg-background/80 backdrop-blur-[1px]">
            <Button
              type="button"
              disabled
              size="lg"
              variant={unloading ? 'destructive' : 'secondary'}
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
            </Button>
            {loadingModel ? (
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={handleOpenLaunchLog}
              >
                <ScrollText data-icon="inline-start" />
                {i18nService.t('localInferenceModelLaunchLogAction')}
              </Button>
            ) : null}
          </div>
        ) : null}

        {isRunning ? (
          <span className="pointer-events-none absolute right-4 top-2 z-10">
            <BreathingDot
              color="var(--zy-success)"
              duration={2}
              label={i18nService.t('localInferenceStatus_running')}
              size={8}
            />
          </span>
        ) : null}

        <CardHeader className="flex flex-col gap-2 p-4">
          <div className="flex min-w-0 w-full items-center gap-2">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
            >
              <ProviderIcon className="size-5" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <CardTitle className="truncate text-base font-semibold leading-6 text-foreground">
                  {displayName}
                </CardTitle>
              </div>
              {modifiedDate ? (
                <div className="flex items-center gap-1.5 text-xs leading-4 text-muted-foreground">
                  <Clock3 aria-hidden="true" className="size-3.5 shrink-0" />
                  <span>{modifiedDate}</span>
                </div>
              ) : null}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground"
                      disabled={buttonsDisabled}
                      aria-label={i18nService.t('coworkSessionActions')}
                      title={i18nService.t('coworkSessionActions')}
                      data-local-inference-model-actions-button="true"
                    >
                      <Ellipsis className="size-5" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuItem onClick={() => onConfigureContext(model)}>
                    <Settings2 className="size-4" />
                    {i18nService.t('localInferenceConfigureContext')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    data-local-inference-delete-button="true"
                    onClick={() => onDelete(model)}
                  >
                    <Trash2 className="size-4" />
                    {i18nService.t('delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="flex min-w-0 w-full items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
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
            <div className="flex shrink-0 items-center">
              {loadingModel ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="min-w-16"
                  disabled={cancellingModelLoad}
                  data-local-inference-cancel-load-button="true"
                  onClick={() => onCancelModelLoad(model.name)}
                >
                  {i18nService.t(
                    cancellingModelLoad
                      ? 'localInferenceModelCancelling'
                      : 'localInferenceCancelModelLoad',
                  )}
                </Button>
              ) : isRunning ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="min-w-16"
                  disabled={buttonsDisabled}
                  data-local-inference-model-action-button="true"
                  data-local-inference-unload-button="true"
                  onClick={() => onUnload(model.name)}
                >
                  {i18nService.t('close')}
                </Button>
              ) : renderLoadButton ? (
                renderLoadButton(model, { disabled: buttonsDisabled, onClick: handleLoadModel })
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="min-w-16"
                  disabled={buttonsDisabled}
                  data-local-inference-model-action-button="true"
                  onClick={handleLoadModel}
                >
                  {i18nService.t('start')}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
});

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[68px_minmax(0,1fr)] items-start gap-2.5">
      <div className={cn('pt-0.5 text-xs font-medium leading-4', localInferenceMutedTextClass)}>
        {label}
      </div>
      <div className="min-w-0 text-sm font-medium leading-5 text-foreground">
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

function getModelCardTags(contextValue?: number): ModelCardTag[] {
  if (!contextValue) return [];

  return [
    {
      label: `${formatContextValue(contextValue)} ${i18nService.t('localInferenceContextShort')}`,
    },
  ];
}

function formatModelFormatTag(value?: string): string | null {
  const normalized = formatModelTagValue(value);
  return normalized ? normalized.toUpperCase() : null;
}

function formatModelTagValue(value?: string): string | null {
  const normalized = value?.trim();
  return normalized || null;
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
