import { Play, RefreshCw, Square, Trash2 } from 'lucide-react';

import type {
  LlamaCppModel as OllamaModel,
  LlamaCppRunningModel as OllamaRunningModel,
} from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import { Badge, EmptyState } from '../components/Common';
import {
  localInferenceMutedTextClass,
  smallDangerButtonClass,
  smallOutlineButtonClass,
} from '../constants';
import { formatBytes, formatDate } from '../utils/progress';

export function ModelsPanel({
  loading,
  unloadingModelName,
  localModels,
  runningModels,
  onLoadModel,
  onUnload,
  onDelete,
}: {
  loading: boolean;
  unloadingModelName: string | null;
  localModels: OllamaModel[];
  runningModels: OllamaRunningModel[];
  onLoadModel: (model: OllamaModel) => void;
  onUnload: (modelName: string) => void;
  onDelete: (modelName: string) => void;
}) {
  const loadedModels = localModels.filter(model =>
    runningModels.some(item => item.name === model.name || item.model === model.name),
  );
  const installedModels = localModels.filter(model =>
    !runningModels.some(item => item.name === model.name || item.model === model.name),
  );

  return (
    <div className="flex flex-col gap-4">
      {loadedModels.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            {i18nService.t('localInferenceStatus_running')}
          </h2>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            {loadedModels.map(model => {
              const runningModel = runningModels.find(
                item => item.name === model.name || item.model === model.name,
              );
              return (
                <ModelCard
                  key={model.name}
                  model={model}
                  runningModel={runningModel}
                  loading={loading}
                  unloading={unloadingModelName === model.name}
                  onLoadModel={() => onLoadModel(model)}
                  onUnload={() => onUnload(model.name)}
                  onDelete={() => onDelete(model.name)}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          {i18nService.t('localInferenceRegisteredModels')}
        </h2>
        {installedModels.length === 0 ? (
          <EmptyState title={i18nService.t('localInferenceNoModels')} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            {installedModels.map(model => {
              return (
                <ModelCard
                  key={model.name}
                  model={model}
                  loading={loading}
                  unloading={unloadingModelName === model.name}
                  onLoadModel={() => onLoadModel(model)}
                  onUnload={() => onUnload(model.name)}
                  onDelete={() => onDelete(model.name)}
                />
              );
            })}
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
}: {
  model: OllamaModel;
  runningModel?: OllamaRunningModel;
  loading: boolean;
  unloading: boolean;
  onLoadModel: () => void;
  onUnload: () => void;
  onDelete: () => void;
}) {
  const isRunning = Boolean(runningModel);
  const cardBusy = unloading;
  const buttonsDisabled = loading || cardBusy;

  return (
    <div
      className={`flex flex-col gap-3 border-b border-border px-3 py-3 last:border-b-0 md:flex-row md:items-center md:justify-between ${cardBusy ? 'bg-surface-raised/20' : ''}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-medium text-foreground">{model.name}</h3>
          {model.details?.parameter_size && <Badge>{model.details.parameter_size}</Badge>}
          {model.details?.quantization_level && <Badge>{model.details.quantization_level}</Badge>}
          {isRunning && <Badge tone="success">{i18nService.t('localInferenceStatus_running')}</Badge>}
        </div>
        <div className={`mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs ${localInferenceMutedTextClass}`}>
          {model.size ? (
            <span>
              {i18nService.t('localInferenceSize')}: {formatBytes(model.size)}
            </span>
          ) : null}
          {model.modified_at ? (
            <span>
              {i18nService.t('localInferenceModified')}: {formatDate(model.modified_at)}
            </span>
          ) : null}
          {model.details?.family ? (
            <span>
              {i18nService.t('localInferenceFamily')}: {model.details.family}
            </span>
          ) : null}
          {model.details?.context_length ? (
            <span>
              {i18nService.t('localInferenceTrainedContext')}: {model.details.context_length}
            </span>
          ) : null}
          {runningModel?.runtime_context_length ? (
            <span>
              {i18nService.t('localInferenceRuntimeContext')}: {runningModel.runtime_context_length}
            </span>
          ) : null}
          {runningModel?.size_vram ? (
            <span>
              {i18nService.t('localInferenceVram')}: {formatBytes(runningModel.size_vram)}
            </span>
          ) : null}
        </div>
        {cardBusy && (
          <div className="mt-3 max-w-xs rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>{i18nService.t('localInferenceUnloadingHint')}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-raised">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
            </div>
          </div>
        )}
      </div>
      <div
        className={`flex shrink-0 flex-wrap items-center gap-2 ${cardBusy ? 'pointer-events-none' : ''}`}
      >
        {isRunning ? (
          <button
            type="button"
            onClick={onUnload}
            disabled={buttonsDisabled}
            className={smallOutlineButtonClass}
          >
            {cardBusy ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            {cardBusy
              ? i18nService.t('localInferenceUnloading')
              : i18nService.t('localInferenceUnload')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onLoadModel}
            disabled={buttonsDisabled}
            className={smallOutlineButtonClass}
          >
            <Play className="h-3.5 w-3.5" />
            {i18nService.t('localInferenceLoad')}
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={buttonsDisabled}
          className={smallDangerButtonClass}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {i18nService.t('delete')}
        </button>
      </div>
    </div>
  );
}

