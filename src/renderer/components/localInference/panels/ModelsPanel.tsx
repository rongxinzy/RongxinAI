import { Button } from '@shared/components/ui/button';
import { Separator } from '@shared/components/ui/separator';
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
import { Spinner } from '@shared/components/ui/spinner';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { cn } from '@shared/lib/utils';
import { ArrowRight, Box, Ellipsis, PanelRightOpen, ScrollText, Trash2 } from 'lucide-react';
import { type DragEvent, memo, useCallback, useEffect, useMemo, useState } from 'react';

import type {
  LlamaCppModel,
  LlamaCppModelPreference,
  LlamaCppModelPreferences,
  LlamaCppRunningModel,
} from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import {
  readLocalModelOrder,
  reconcileLocalModelOrder,
  reorderLocalModelOrder,
  writeLocalModelOrder,
} from '../utils/modelOrder';
import { ListPagination } from '../../common/ListPagination';
import { formatBytes, formatDate } from '../utils/progress';

const MODELS_PER_PAGE = 16;

function preventModelCardDragOver(event: DragEvent<HTMLDivElement>) {
  event.preventDefault();
}

function noopOpenLaunchLog() {
  // Launch log panel is optional; some hosts do not provide one.
}

function noopOpenInspector() {
  // Model inspector is optional; some hosts do not provide one.
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
  onOpenInspector?: (model: LlamaCppModel) => void;
  onOpenMarketplace?: () => void;
  onOpenLaunchLog?: (model: LlamaCppModel) => void;
  renderLoadButton?: (
    model: LlamaCppModel,
    props: { disabled: boolean; onClick: () => void },
  ) => React.ReactNode;
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
  onOpenInspector: (model: LlamaCppModel) => void;
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
  onOpenLaunchLog: (model: LlamaCppModel) => void;
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
  onOpenInspector,
  onOpenMarketplace,
  onOpenLaunchLog,
  renderLoadButton,
}: ModelsPanelProps) {
  const [pendingDeleteModel, setPendingDeleteModel] = useState<LlamaCppModel | null>(null);
  const [modelOrder, setModelOrder] = useState<string[]>(readLocalModelOrder);
  const [draggedModelName, setDraggedModelName] = useState<string | null>(null);
  const [modelPage, setModelPage] = useState(1);
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
    return orderedModelNames
      .flatMap(name => {
        const model = modelsByName.get(name);
        return model ? [{ model, runningModel: findRunningModel(runningModels, model.name) }] : [];
      })
      .sort((a, b) => Number(Boolean(b.runningModel)) - Number(Boolean(a.runningModel)));
  }, [availableModels, orderedModelNames, runningModels]);
  const totalModelPages = Math.max(1, Math.ceil(modelCards.length / MODELS_PER_PAGE));
  const currentModelPage = Math.min(modelPage, totalModelPages);
  const visibleModelCards = modelCards.slice(
    (currentModelPage - 1) * MODELS_PER_PAGE,
    currentModelPage * MODELS_PER_PAGE,
  );

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

  const handleCardDragStart = useCallback((event: DragEvent<HTMLDivElement>, modelName: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', modelName);
    setDraggedModelName(modelName);
  }, []);

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
        {modelCards.length > 0 ? (
          <>
            {[true, false].map(isRunning => {
              const rows = visibleModelCards.filter(
                entry => Boolean(entry.runningModel) === isRunning,
              );
              if (!rows.length) return null;
              return (
                <section className="@container mb-3" key={String(isRunning)}>
                  <h2 className="theme-heading mb-2">
                    {i18nService.t(
                      isRunning ? 'localInferenceStatus_running' : 'localInferenceStatus_installed',
                    )}
                  </h2>
                  {rows.map(({ model, runningModel }) => (
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
                      onOpenInspector={onOpenInspector ?? noopOpenInspector}
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
                </section>
              );
            })}
            <ListPagination
              page={currentModelPage}
              totalPages={totalModelPages}
              onPageChange={setModelPage}
              className="pt-1"
            />
          </>
        ) : (
          <Empty className="theme-scene-model-empty mx-auto min-h-80 w-full max-w-[800px]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Box className="size-5" />
              </EmptyMedia>
              <EmptyTitle className="theme-scene-model-empty-title">
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
                  className="min-w-28"
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
  onOpenInspector,
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
  const quantization = model.details?.quantization_level?.trim();
  const contextValue = getPreferredContext(model, runningModel, preference);
  const modifiedDate = model.modified_at ? formatModelCardDate(model.modified_at) : null;
  const handleLoadModel = () => onLoadModel(model);
  const metadata = [
    formatModelFormatTag(model.details?.format),
    contextValue
      ? `${formatContextValue(contextValue)} ${i18nService.t('localInferenceContextShort')}`
      : null,
    modifiedDate,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div
      data-local-inference-model-card-frame="true"
      draggable={!loadingModel && !unloading}
      onDragStart={event => onDragStart(event, model.name)}
      onDragOver={onDragOver}
      onDrop={event => onDrop(event, model.name)}
      onDragEnd={onDragEnd}
      className={cn('cursor-grab active:cursor-grabbing', dragging && 'opacity-50')}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-4 @min-[38rem]:grid-cols-[minmax(0,1fr)_7rem_6rem_auto]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isRunning && <span aria-hidden="true" className="theme-shell-status-dot shrink-0" />}
            <span className="theme-heading truncate" title={displayName}>
              {displayName}
            </span>
          </div>
          {metadata && (
            <div className="theme-control-caption-muted mt-1 truncate" title={metadata}>
              {metadata}
            </div>
          )}
        </div>
        <div className="theme-control-caption-muted hidden @min-[38rem]:block">
          {quantization || '—'}
        </div>
        <div className="theme-control-caption-muted hidden tabular-nums @min-[38rem]:block">
          {model.size ? formatBytes(model.size) : '—'}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {loadingModel || unloading ? (
            <>
              <Button variant="ghost" size="sm" disabled>
                <Spinner />
                {i18nService.t(
                  unloading ? 'localInferenceModelClosing' : 'localInferenceModelLoading',
                )}
              </Button>
              {loadingModel && (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={i18nService.t('localInferenceModelLaunchLogAction')}
                    onClick={() => onOpenLaunchLog(model)}
                  >
                    <ScrollText />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
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
                </>
              )}
            </>
          ) : isRunning ? (
            <Button
              size="sm"
              variant="outline"
              disabled={buttonsDisabled}
              data-local-inference-model-action-button="true"

              onClick={() => onUnload(model.name)}
            >
              {i18nService.t('stop')}
            </Button>
          ) : renderLoadButton ? (
            renderLoadButton(model, { disabled: buttonsDisabled, onClick: handleLoadModel })
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={buttonsDisabled}
              data-local-inference-model-action-button="true"
              onClick={handleLoadModel}
            >
              {i18nService.t('start')}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="theme-control-muted"
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
              <DropdownMenuItem onClick={() => onOpenInspector(model)}>
                <PanelRightOpen className="size-4" />
                {i18nService.t('localInferenceOpenInspector')}
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
        <div className="theme-control-caption-muted col-span-full @min-[38rem]:hidden">
          {[quantization, model.size ? formatBytes(model.size) : null].filter(Boolean).join(' · ')}
        </div>
      </div>
      <Separator />
    </div>
  );
});

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
