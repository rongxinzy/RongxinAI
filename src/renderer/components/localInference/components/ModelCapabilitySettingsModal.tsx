import { Button } from '@shared/components/ui/button';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import type { LlamaCppModelPreference } from '../../../../shared/llamacpp';
import type { ModelCapabilities } from '../../../../shared/providers';
import { ModelCapabilityStatus, ProviderName } from '../../../../shared/providers';
import { i18nService } from '../../../services/i18n';
import {
  parseLlamaCppModelCapabilities,
  parseOllamaModelCapabilities,
} from '../../../services/modelCapabilityProbe';
import Modal from '../../common/Modal';
import { localInferenceCompactButtonClass } from '../constants';
import { ModelCapabilitiesFields } from '../../settings/ModelCapabilitiesFields';

type LocalCapabilityModel = {
  id?: string;
  name: string;
  capabilities?: Partial<ModelCapabilities>;
  supportsThinkingToggle?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  runtime_context_length?: number;
  trained_context_length?: number;
  details?: { context_length?: number };
  llamaCppRuntimeContextWindow?: number;
  llamaCppTrainedContextWindow?: number;
};

type LocalRuntimeModel = {
  name?: string;
  model?: string;
  id?: string;
  context_length?: number;
  runtime_context_length?: number;
};

type ModelCapabilitySettingsModalProps = {
  isOpen: boolean;
  model: LocalCapabilityModel | null;
  provider?: typeof ProviderName.Ollama | typeof ProviderName.LlamaCpp;
  preference?: LlamaCppModelPreference;
  onClose: () => void;
  onSave?: (toolCalling: ModelCapabilityStatus) => void;
};

const TOKENS_PER_K = 1024;

const formatTokenK = (tokens?: number): string => {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return '';
  return String(Number((tokens / TOKENS_PER_K).toFixed(2)));
};

export function ModelCapabilitySettingsModal({
  isOpen,
  model,
  provider = ProviderName.LlamaCpp,
  preference,
  onClose,
  onSave,
}: ModelCapabilitySettingsModalProps) {
  const [toolCalling, setToolCalling] = useState<ModelCapabilityStatus>(
    ModelCapabilityStatus.Unknown,
  );
  const [detectedCapabilities, setDetectedCapabilities] = useState<Partial<ModelCapabilities>>({});
  const [runtimeContextWindow, setRuntimeContextWindow] = useState<number>();

  useEffect(() => {
    if (!isOpen || !model) return;

    setToolCalling(
      preference?.capabilities?.toolCalling ??
        model.capabilities?.toolCalling ??
        ModelCapabilityStatus.Unknown,
    );
    setDetectedCapabilities({});
    setRuntimeContextWindow(undefined);
    const showModel =
      provider === ProviderName.Ollama
        ? window.electron.ollama.showModel
        : window.electron.llamacpp.showModel;
    void showModel(model.id || model.name)
      .then(payload => {
        const detected =
          provider === ProviderName.Ollama
            ? parseOllamaModelCapabilities(payload)
            : parseLlamaCppModelCapabilities(payload);
        setDetectedCapabilities(detected);
        if (preference?.capabilities?.toolCalling === undefined && detected.toolCalling) {
          setToolCalling(detected.toolCalling);
        }
      })
      .catch(() => undefined);
    const listRunningModels =
      provider === ProviderName.Ollama
        ? window.electron.ollama.listRunningModels
        : window.electron.llamacpp.listRunningModels;
    void listRunningModels()
      .then(models => {
        const target = model.id || model.name;
        const runningModel = (models as LocalRuntimeModel[]).find(candidate =>
          [candidate.name, candidate.model, candidate.id].includes(target),
        );
        setRuntimeContextWindow(
          runningModel?.context_length ?? runningModel?.runtime_context_length,
        );
      })
      .catch(() => undefined);
  }, [isOpen, model, preference?.capabilities?.toolCalling, provider]);

  if (!model) return null;

  const reasoning =
    model.supportsThinkingToggle === true
      ? ModelCapabilityStatus.Supported
      : model.supportsThinkingToggle === false
        ? ModelCapabilityStatus.Unsupported
        : ModelCapabilityStatus.Unknown;
  const toolCallingEditable =
    provider === ProviderName.LlamaCpp &&
    (preference?.capabilities?.toolCalling !== undefined ||
      detectedCapabilities.toolCalling !== undefined);
  const contextWindow = resolveModelCapabilityContextWindow({
    model,
    preference,
    runtimeContextWindow,
  });
  const maxTokens = model.maxTokens ?? 4096;
  const capabilities: Partial<ModelCapabilities> = {
    ...model.capabilities,
    ...detectedCapabilities,
    toolCalling,
    reasoning,
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="w-full max-w-md rounded-xl border border-border bg-surface p-4 shadow-modal"
    >
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">{model.name}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={i18nService.t('cancel')}
            className="size-7 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </Button>
        </div>
        <ModelCapabilitiesFields
          capabilities={capabilities}
          contextWindow={formatTokenK(contextWindow)}
          maxTokens={formatTokenK(maxTokens)}
          editableCapabilities={{ toolCalling: toolCallingEditable }}
          onCapabilityChange={(key, value) => {
            if (key === 'toolCalling') setToolCalling(value);
          }}
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className={localInferenceCompactButtonClass}
            onClick={onClose}
          >
            {i18nService.t('cancel')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={localInferenceCompactButtonClass}
            onClick={() => {
              onSave?.(toolCalling);
              if (!onSave) onClose();
            }}
          >
            {i18nService.t('save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function resolveModelCapabilityContextWindow({
  model,
  preference,
  runtimeContextWindow,
}: {
  model: LocalCapabilityModel;
  preference?: LlamaCppModelPreference;
  runtimeContextWindow?: number;
}): number | undefined {
  return (
    preference?.ctxSize ??
    runtimeContextWindow ??
    model.contextWindow ??
    model.llamaCppRuntimeContextWindow ??
    model.runtime_context_length ??
    model.llamaCppTrainedContextWindow ??
    model.trained_context_length ??
    model.details?.context_length
  );
}
