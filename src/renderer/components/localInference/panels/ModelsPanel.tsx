import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  PlayIcon,
  ServerStackIcon,
  StopIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

import type {
  LlamaCppModel as OllamaModel,
  LlamaCppRunningModel as OllamaRunningModel,
} from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import { Badge, EmptyState } from '../components/Common';
import {
  smallDangerButtonClass,
  smallOutlineButtonClass,
} from '../constants';
import { formatBytes, formatDate } from '../utils/progress';

export function ModelsPanel({
  loading,
  unloadingModelName,
  localModels,
  runningModels,
  pullName,
  pulling,
  onPullNameChange,
  onPull,
  onCancelPull,
  onLoadModel,
  onUnload,
  onDelete,
  onOpenInference,
}: {
  loading: boolean;
  unloadingModelName: string | null;
  localModels: OllamaModel[];
  runningModels: OllamaRunningModel[];
  pullName: string;
  pulling: boolean;
  onPullNameChange: (value: string) => void;
  onPull: () => void;
  onCancelPull: () => void;
  onLoadModel: (model: OllamaModel) => void;
  onUnload: (modelName: string) => void;
  onDelete: (modelName: string) => void;
  onOpenInference: (modelName: string) => void;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-surface px-3 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          {i18nService.t('localInferencePullTitle')}
        </h2>
        <p className="mt-1 text-xs text-secondary">{i18nService.t('localInferencePullHint')}</p>
        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
          <input
            value={pullName}
            onChange={event => onPullNameChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && pullName.trim() && !pulling) onPull();
            }}
            disabled={pulling}
            placeholder={i18nService.t('localInferencePullPlaceholder')}
            className="h-8 flex-1 rounded-md border border-border bg-background px-2.5 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary/60 disabled:opacity-60"
          />
          {pulling ? (
            <button type="button" onClick={onCancelPull} className={smallOutlineButtonClass}>
              <StopIcon className="h-3.5 w-3.5" />
              {i18nService.t('localInferenceCancelPull')}
            </button>
          ) : (
            <button
              type="button"
              onClick={onPull}
              disabled={!pullName.trim() || loading}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              {i18nService.t('localInferencePull')}
            </button>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          {i18nService.t('localInferenceRegisteredModels')}
        </h2>
        {localModels.length === 0 ? (
          <EmptyState title={i18nService.t('localInferenceNoModels')} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            {localModels.map(model => {
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
                  onOpenInference={() => onOpenInference(model.name)}
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
  onOpenInference,
}: {
  model: OllamaModel;
  runningModel?: OllamaRunningModel;
  loading: boolean;
  unloading: boolean;
  onLoadModel: () => void;
  onUnload: () => void;
  onDelete: () => void;
  onOpenInference: () => void;
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
          <h3 className="truncate font-mono text-sm font-medium text-foreground">{model.name}</h3>
          {model.details?.parameter_size && <Badge>{model.details.parameter_size}</Badge>}
          {model.details?.quantization_level && <Badge>{model.details.quantization_level}</Badge>}
          {isRunning && <Badge tone="success">{i18nService.t('localInferenceLoaded')}</Badge>}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
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
              <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-primary" />
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
              <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <StopIcon className="h-3.5 w-3.5" />
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
            <PlayIcon className="h-3.5 w-3.5" />
            {i18nService.t('localInferenceLoad')}
          </button>
        )}
        <button
          type="button"
          onClick={onOpenInference}
          disabled={buttonsDisabled}
          className={smallOutlineButtonClass}
        >
          <ServerStackIcon className="h-3.5 w-3.5" />
          {i18nService.t('localInferenceInfer')}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={buttonsDisabled}
          className={smallDangerButtonClass}
        >
          <TrashIcon className="h-3.5 w-3.5" />
          {i18nService.t('delete')}
        </button>
      </div>
    </div>
  );
}

