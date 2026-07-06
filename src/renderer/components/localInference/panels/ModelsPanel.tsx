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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { cn } from '@shared/lib/utils';
import { Ellipsis, Play, RefreshCw, Square, Trash2 } from 'lucide-react';

import type {
  LlamaCppModel,
  LlamaCppRunningModel,
} from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import { EmptyState } from '../components/Common';
import { localInferenceMutedTextClass } from '../constants';
import { formatBytes, formatDate } from '../utils/progress';

type ModelsPanelProps = {
  loading: boolean;
  unloadingModelName: string | null;
  localModels: LlamaCppModel[];
  runningModels: LlamaCppRunningModel[];
  onLoadModel: (model: LlamaCppModel) => void;
  onUnload: (modelName: string) => void;
  onDelete: (modelName: string) => void;
};

type ModelCardProps = {
  model: LlamaCppModel;
  runningModel?: LlamaCppRunningModel;
  loading: boolean;
  unloading: boolean;
  onLoadModel: () => void;
  onUnload: () => void;
  onDelete: () => void;
};

export function ModelsPanel({
  loading,
  unloadingModelName,
  localModels,
  runningModels,
  onLoadModel,
  onUnload,
  onDelete,
}: ModelsPanelProps) {
  const loadedModels = localModels.filter(model => findRunningModel(runningModels, model.name));
  const installedModels = localModels.filter(model => !findRunningModel(runningModels, model.name));

  return (
    <div className="flex flex-col gap-6">
      {loadedModels.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            {i18nService.t('localInferenceStatus_running')}
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {loadedModels.map(model => (
              <ModelCard
                key={model.name}
                model={model}
                runningModel={findRunningModel(runningModels, model.name)}
                loading={loading}
                unloading={unloadingModelName === model.name}
                onLoadModel={() => onLoadModel(model)}
                onUnload={() => onUnload(model.name)}
                onDelete={() => onDelete(model.name)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          {i18nService.t('localInferenceRegisteredModels')}
        </h2>
        {installedModels.length === 0 ? (
          <EmptyState title={i18nService.t('localInferenceNoModels')} className="min-h-[160px]" />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {installedModels.map(model => (
              <ModelCard
                key={model.name}
                model={model}
                loading={loading}
                unloading={unloadingModelName === model.name}
                onLoadModel={() => onLoadModel(model)}
                onUnload={() => onUnload(model.name)}
                onDelete={() => onDelete(model.name)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ModelCard({
  model,
  runningModel,
  loading,
  unloading,
  onLoadModel,
  onUnload,
  onDelete,
}: ModelCardProps) {
  const isRunning = Boolean(runningModel);
  const buttonsDisabled = loading || unloading;
  const displayName = getModelDisplayName(model.name);
  const quantization = model.details?.quantization_level?.trim();
  const contextValue = getPreferredContext(model, runningModel);
  const details = getModelDetails(model);

  return (
    <Card
      size="sm"
      className={cn(
        'relative h-full border border-border/70 bg-background/95 py-0 shadow-sm ring-0 transition-all duration-200',
        'hover:border-border hover:shadow-[0_12px_32px_rgba(15,23,42,0.06)]',
        isRunning && 'border-primary/30 shadow-[0_12px_32px_rgba(59,130,246,0.08)]',
        unloading && 'border-primary/30 bg-muted/30',
      )}
    >
      <div
        className={cn(
          'absolute inset-x-0 top-0 h-0.5 bg-transparent',
          isRunning && 'bg-primary/70',
        )}
      />

      <CardHeader className="gap-2 pb-0 pt-3">
        <CardAction className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={i18nService.t('localInferenceMoreParams')}
                className="text-foreground/45 hover:text-foreground"
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[112px]">
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                {i18nService.t('delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>

        <div className="flex min-w-0 flex-col gap-1.5 pl-1">
          <CardTitle className="truncate text-[14px] font-semibold text-foreground">
            {displayName}
          </CardTitle>

          <div className="flex flex-wrap items-center gap-1.5">
            {isRunning ? (
              <Badge variant="secondary">{i18nService.t('localInferenceStatus_running')}</Badge>
            ) : null}
            {quantization ? (
              <Badge variant="outline" className="font-mono text-[11px]">
                {quantization}
              </Badge>
            ) : null}
            {contextValue ? (
              <Badge variant="outline" className="text-[11px]">
                {formatContextValue(contextValue)} {i18nService.t('localInferenceContextShort')}
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-2.5 pt-2">
        <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
          <div className="grid gap-2">
            {details.map(item => (
              <MetadataRow key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
        </div>

        {unloading ? (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>{i18nService.t('localInferenceUnloadingHint')}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/10">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
            </div>
          </div>
        ) : null}
      </CardContent>

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
            <Play data-icon="inline-start" />
            {i18nService.t('localInferenceLoad')}
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

function getModelDetails(model: LlamaCppModel): Array<{ label: string; value: string }> {
  return [
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

function matchesModelName(model: LlamaCppRunningModel, modelName: string): boolean {
  return model.name === modelName || model.model === modelName;
}

function getPreferredContext(
  model: LlamaCppModel,
  runningModel?: LlamaCppRunningModel,
): number | undefined {
  return runningModel?.runtime_context_length
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
