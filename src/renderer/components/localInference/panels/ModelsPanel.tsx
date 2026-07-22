import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Button21st } from '@shared/components/ui/button-21st';
import { Card, CardAction, CardHeader, CardTitle } from '@shared/components/ui/card';
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
import { type ComponentType, type DragEvent, useEffect, useMemo, useState } from 'react';

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
import { localInferenceMutedTextClass } from '../constants';
import {
  readLocalModelOrder,
  reconcileLocalModelOrder,
  reorderLocalModelOrder,
  writeLocalModelOrder,
} from '../utils/modelOrder';
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
const ModelCardTagKind = {
  Neutral: 'neutral',
  Violet: 'violet',
  Green: 'green',
} as const;

type ModelCardTagKind = (typeof ModelCardTagKind)[keyof typeof ModelCardTagKind];

type ModelCardTag = {
  label: string;
  kind: ModelCardTagKind;
};

const modelCardTagBaseClassName = 'h-7 rounded-md px-2.5 py-0 text-xs font-normal shadow-none';
const modelCardTagColorClassNames: Record<ModelCardTagKind, string> = {
  [ModelCardTagKind.Neutral]:
    'border-[var(--zy-model-tag-neutral-border)] bg-[var(--zy-model-tag-neutral-background)] text-[var(--zy-model-tag-neutral-foreground)]',
  [ModelCardTagKind.Violet]:
    'border-[var(--zy-model-tag-violet-border)] bg-[var(--zy-model-tag-violet-background)] text-[var(--zy-model-tag-violet-foreground)]',
  [ModelCardTagKind.Green]:
    'border-[var(--zy-model-tag-green-border)] bg-[var(--zy-model-tag-green-background)] text-[var(--zy-model-tag-green-foreground)]',
};

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
};

type ModelCardEntry = {
  model: LlamaCppModel;
  runningModel?: LlamaCppRunningModel;
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
}: ModelsPanelProps) {
  const [pendingDeleteModel, setPendingDeleteModel] = useState<LlamaCppModel | null>(null);
  const [modelOrder, setModelOrder] = useState<string[]>(readLocalModelOrder);
  const [draggedModelName, setDraggedModelName] = useState<string | null>(null);
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
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
            {modelCards.map(({ model, runningModel }) => (
              <ModelCard
                key={model.name}
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
              />
            ))}
          </div>
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
  const visibleTags = getModelCardTags(model, contextValue, quantization).slice(
    0,
    hasDetailsTag ? MODEL_CARD_MAX_VISIBLE_TAGS - 1 : MODEL_CARD_MAX_VISIBLE_TAGS,
  );
  const modifiedDate = model.modified_at ? formatModelCardDate(model.modified_at) : null;
  const handleOpenLaunchLog = () => {
    onOpenLaunchLog(model.name);
  };

  return (
    <Card
      size="sm"
      draggable={!loadingModel && !unloading}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        'relative w-full cursor-grab select-none border border-border/70 bg-card p-0 shadow-sm ring-0 transition-all duration-200 active:cursor-grabbing',
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

      <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto_auto] gap-x-3 gap-y-2 p-3">
        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
          >
            <ProviderIcon className="size-7" />
          </span>
          <CardTitle className="truncate text-base font-semibold leading-6 text-foreground">
            {displayName}
          </CardTitle>
        </div>

        <div className="col-start-1 row-start-2 flex items-center gap-2">
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

        <div className="col-start-1 row-start-3 flex min-w-0 flex-wrap items-center gap-1.5 pr-2">
          {hasDetailsTag ? (
            <HoverCard>
              <HoverCardTrigger
                delay={200}
                closeDelay={100}
                render={
                  <Badge
                    variant="outline"
                    className={cn(
                      getModelCardTagClassName(ModelCardTagKind.Neutral),
                      'cursor-default',
                    )}
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
            <Badge key={tag.label} variant="outline" className={getModelCardTagClassName(tag.kind)}>
              {tag.label}
            </Badge>
          ))}
        </div>

        <CardAction className="col-start-2 row-span-1 row-start-3 self-center justify-self-end">
          {isRunning ? (
            <Button21st
              type="button"
              variant="danger"
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
              isDisabled={buttonsDisabled}
              data-local-inference-model-action-button="true"
              onClick={onLoadModel}
            >
              <Play data-icon="inline-start" />
              {i18nService.t('start')}
            </Button21st>
          )}
        </CardAction>
      </CardHeader>
    </Card>
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
  return [
    quantization
      ? {
          label: i18nService.t('localInferenceQuantization'),
          value: quantization,
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
    createModelCardTag(formatModelFamilyTag(model.details?.family), ModelCardTagKind.Neutral),
    createModelCardTag(
      formatModelTagValue(model.details?.parameter_size),
      ModelCardTagKind.Neutral,
    ),
    createModelCardTag(formatModelTagValue(quantization), ModelCardTagKind.Violet),
    createModelCardTag(formatModelFormatTag(model.details?.format), ModelCardTagKind.Green),
    createModelCardTag(
      contextValue
        ? `${formatContextValue(contextValue)} ${i18nService.t('localInferenceContextShort')}`
        : null,
      ModelCardTagKind.Violet,
    ),
  ]);
}

function getModelCardTagClassName(kind: ModelCardTagKind): string {
  return cn(modelCardTagBaseClassName, modelCardTagColorClassNames[kind]);
}

function createModelCardTag(label: string | null, kind: ModelCardTagKind): ModelCardTag | null {
  return label ? { label, kind } : null;
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
