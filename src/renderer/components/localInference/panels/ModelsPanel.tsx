import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@shared/components/ui/hover-card';
import { cn } from '@shared/lib/utils';
import { Box, Ellipsis, Play, RefreshCw, Square, Trash2 } from 'lucide-react';
import { type ComponentType, useState } from 'react';

import type {
  LlamaCppModel,
  LlamaCppModelPreference,
  LlamaCppModelPreferences,
  LlamaCppRunningModel,
} from '../../../../shared/llamacpp';
import { ProviderName } from '../../../../shared/providers';
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
import { resolveLocalModelProvider } from '../utils/modelProvider';
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
} satisfies Record<string, ComponentType<{ className?: string }>>;

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
};

type ModelCardProps = {
  model: LlamaCppModel;
  runningModel?: LlamaCppRunningModel;
  preference?: LlamaCppModelPreference;
  loading: boolean;
  loadingModel: boolean;
  unloading: boolean;
  onLoadModel: () => void;
  onUnload: () => void;
  onRequestDelete: () => void;
  onConfigureContext: () => void;
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
}: ModelsPanelProps) {
  const [pendingDeleteModel, setPendingDeleteModel] = useState<LlamaCppModel | null>(null);
  const loadedModels = runningModels.map(runningModel => ({
    model: findModelByName(localModels, runningModel.name ?? runningModel.model ?? '')
      ?? toModelCardModel(runningModel),
    runningModel,
  }));
  const installedModels = localModels.filter(model => !findRunningModel(runningModels, model.name));
  const pendingDeleteRunningModel = pendingDeleteModel
    ? findRunningModel(runningModels, pendingDeleteModel.name)
    : undefined;
  const pendingDeleteDisplayName = pendingDeleteModel
    ? getModelDisplayName(pendingDeleteModel.name)
    : '';
  const pendingDeleteBusy =
    loading || (!!pendingDeleteModel && unloadingModelName === pendingDeleteModel.name);

  return (
    <div className="flex flex-col gap-6">
      {loadedModels.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            {i18nService.t('localInferenceStatus_running')}
          </h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] items-start gap-4">
            {loadedModels.map(model => (
              <ModelCard
                key={model.runningModel.name ?? model.runningModel.model ?? model.model.name}
                model={model.model}
                runningModel={model.runningModel}
                preference={modelPreferences[model.model.name]}
                loading={loading}
                loadingModel={loadingModelName === model.model.name}
                unloading={unloadingModelName === model.model.name}
                onLoadModel={() => onLoadModel(model.model)}
                onUnload={() => onUnload(model.model.name)}
                onRequestDelete={() => setPendingDeleteModel(model.model)}
                onConfigureContext={() => onConfigureContext(model.model)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          {i18nService.t('localInferenceRegisteredModels')}
        </h2>
        {installedModels.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] items-start gap-4">
            {installedModels.map(model => (
              <ModelCard
                key={model.name}
                model={model}
                preference={modelPreferences[model.name]}
                loading={loading}
                loadingModel={loadingModelName === model.name}
                unloading={unloadingModelName === model.name}
                onLoadModel={() => onLoadModel(model)}
                onUnload={() => onUnload(model.name)}
                onRequestDelete={() => setPendingDeleteModel(model)}
                onConfigureContext={() => onConfigureContext(model)}
              />
            ))}
          </div>
        ) : null}
      </section>

      <Dialog
        open={Boolean(pendingDeleteModel)}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteModel(null);
        }}
      >
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{i18nService.t('confirmDelete')}</DialogTitle>
            <DialogDescription>
              {pendingDeleteRunningModel
                ? i18nService.t('localInferenceDeleteRunningBlocked')
                : i18nService.t('localInferenceDeleteConfirmMessage').replace('{name}', pendingDeleteDisplayName)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDeleteModel(null)}
            >
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
  onUnload,
  onRequestDelete,
  onConfigureContext,
}: ModelCardProps) {
  const isRunning = Boolean(runningModel);
  const buttonsDisabled = loading || unloading;
  const displayName = getModelDisplayName(model.name);
  const provider = resolveLocalModelProvider(model);
  const ProviderIcon = provider ? modelProviderIconMap[provider] : Box;
  const quantization = model.details?.quantization_level?.trim();
  const contextValue = getPreferredContext(model, runningModel, preference);
  const details = getModelDetails(model, quantization);
  return (
    <Card
      size="sm"
      className={cn(
        'relative border border-border/70 bg-background/95 py-0 shadow-sm ring-0 transition-all duration-200',
        'hover:border-border hover:shadow-[0_12px_32px_rgba(15,23,42,0.06)]',
        isRunning && 'border-primary/30 shadow-[0_12px_32px_rgba(59,130,246,0.08)]',
        (loadingModel || unloading) && 'border-primary/30 bg-muted/30',
      )}
    >
      <div
        className={cn(
          'absolute inset-x-0 top-0 h-0.5 bg-transparent',
          isRunning && 'bg-primary/70',
        )}
      />

      <CardHeader className="gap-2 pb-0 pt-3">
        {!isRunning ? (
          <CardAction className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={i18nService.t('localInferenceMoreParams')}
                  className="text-foreground/45 hover:text-foreground"
                >
                  <Ellipsis />
                </Button>
              } />
              <DropdownMenuContent align="end" className="min-w-[112px]">
                <DropdownMenuItem disabled={buttonsDisabled} onClick={onConfigureContext}>
                  {i18nService.t('localInferenceConfigureContext')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={buttonsDisabled}
                  variant="destructive"
                  onClick={onRequestDelete}
                >
                  <Trash2 />
                  {i18nService.t('delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        ) : null}

        <div className="flex min-w-0 items-start gap-2 pl-1">
          <span aria-hidden="true" className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
            <ProviderIcon className="size-5 text-muted-foreground" />
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <CardTitle className="truncate text-[14px] font-semibold text-foreground">
              {displayName}
            </CardTitle>

            <div className="flex flex-wrap items-center gap-1.5">
              {details.length > 0 ? (
                <HoverCard>
                  <HoverCardTrigger
                    delay={200}
                    closeDelay={100}
                    render={
                      <Badge variant="outline" className="cursor-default text-[11px]">
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
              {contextValue ? (
                <Badge variant="outline" className="text-[11px]">
                  {formatContextValue(contextValue)} {i18nService.t('localInferenceContextShort')}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
      </CardHeader>

      {loadingModel || unloading ? (
        <CardContent className="flex flex-col gap-2.5 pt-2">
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>
                {loadingModel
                  ? i18nService.t('localInferenceLoadingHint')
                  : i18nService.t('localInferenceUnloadingHint')}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/10">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
            </div>
          </div>
        </CardContent>
      ) : null}

      <CardFooter className="border-t border-border/70 bg-muted/20 px-3 py-2">
        {isRunning ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={buttonsDisabled}
            onClick={onUnload}
            className="w-full"
          >
            {unloading ? (
              <RefreshCw data-icon="inline-start" className="animate-spin" />
            ) : (
              <Square data-icon="inline-start" />
            )}
            {unloading
              ? i18nService.t('localInferenceUnloading')
              : i18nService.t('localInferenceUnload')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={buttonsDisabled}
            onClick={onLoadModel}
            className="w-full"
          >
            {loadingModel ? (
              <RefreshCw data-icon="inline-start" className="animate-spin" />
            ) : (
              <Play data-icon="inline-start" />
            )}
            {loadingModel
              ? i18nService.t('localInferenceLoadingModel')
              : i18nService.t('localInferenceLoad')}
          </Button>
        )}
      </CardFooter>
    </Card>
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

function findModelByName(models: LlamaCppModel[], modelName: string): LlamaCppModel | undefined {
  return models.find(model => matchesModelName(model, modelName));
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
  return runningModel?.runtime_context_length
    ?? preference?.ctxSize
    ?? model.runtime_context_length
    ?? model.trained_context_length
    ?? model.details?.context_length;
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
