import type { LlamaCppRunningModel } from '../../shared/llamacpp';
import {
  isProviderEnabled,
  ProviderName,
  ProviderRegistry,
  resolveCodingPlanBaseUrl,
} from '../../shared/providers';
import { type AppConfig, getProviderDisplayName } from '../config';
import type { Model } from '../store/slices/modelSlice';
import { getRunningModelOpenClawEligibility } from '../utils/llamacppOpenClawEligibility';

export const LLAMACPP_RUNNING_MODELS_CHANGED_EVENT = 'llamacpp:running-models-changed';

type ModelLike = Pick<Model, 'id' | 'providerKey'>;

const sameModelIdentity = (modelA: ModelLike, modelB: ModelLike): boolean =>
  modelA.id === modelB.id && (modelA.providerKey ?? '') === (modelB.providerKey ?? '');

export function buildConfiguredAvailableModels(config: AppConfig): Model[] {
  const models: Model[] = [];

  if (!config.providers) {
    return config.model.availableModels.map(model => ({
      id: model.id,
      name: model.name,
      supportsImage: model.supportsImage ?? false,
    }));
  }

  Object.entries(config.providers).forEach(([providerName, providerConfig]) => {
    if (providerName === ProviderName.LlamaCpp) {
      return;
    }
    if (!isProviderEnabled(providerName, providerConfig)) {
      return;
    }

    const providerDefinition = ProviderRegistry.get(providerName);
    const configuredModels =
      providerConfig.codingPlanEnabled && providerDefinition?.codingPlanModels
        ? providerDefinition.codingPlanModels
        : providerConfig.models;
    if (!configuredModels) {
      return;
    }
    const configuredApiFormat =
      providerConfig.apiFormat ?? providerDefinition?.defaultApiFormat ?? 'anthropic';
    const effectiveApiFormat =
      providerConfig.codingPlanEnabled &&
      (configuredApiFormat === 'anthropic' || configuredApiFormat === 'openai')
        ? resolveCodingPlanBaseUrl(providerName, true, configuredApiFormat, providerConfig.baseUrl)
            .effectiveFormat
        : configuredApiFormat;

    configuredModels.forEach(model => {
      const supportsImage = ProviderRegistry.resolveModelSupportsImage(
        providerName,
        model.id,
        model.supportsImage,
      );
      models.push({
        id: model.id,
        name: model.name,
        provider: getProviderDisplayName(providerName, providerConfig),
        providerKey: providerName,
        openClawProviderId: ProviderRegistry.getOpenClawProviderId(providerName),
        supportsImage,
        capabilities: ProviderRegistry.resolveModelCapabilities(
          providerName,
          model.id,
          effectiveApiFormat,
          { ...model, supportsImage },
        ),
        contextWindow:
          model.contextWindow ?? ('contextTokens' in model ? model.contextTokens : undefined),
      });
    });
  });

  if (models.length > 0) {
    return models;
  }

  return config.model.availableModels.map(model => ({
    id: model.id,
    name: model.name,
    supportsImage: model.supportsImage ?? false,
  }));
}

export function buildLlamaCppRunningModels(runningModels: LlamaCppRunningModel[]): Model[] {
  const models: Model[] = [];

  runningModels.forEach(model => {
    const name = model.name?.trim() || model.model?.trim() || model.id?.trim() || '';
    if (!name) {
      return;
    }
    const eligibility = getRunningModelOpenClawEligibility(model);
    models.push({
      id: name,
      name,
      provider: 'llama.cpp',
      providerKey: ProviderName.LlamaCpp,
      openClawProviderId: ProviderRegistry.getOpenClawProviderId(ProviderName.LlamaCpp),
      supportsImage: false,
      supportsThinkingToggle: model.supportsThinkingToggle,
      llamaCppOpenClawEligibility: eligibility,
      llamaCppRuntimeContextWindow: eligibility.runtimeContextWindow,
      llamaCppTrainedContextWindow: eligibility.trainedContextWindow,
    });
  });

  return models;
}

export function mergeAvailableModels(
  configuredModels: Model[],
  llamaCppRunningModels: Model[],
): Model[] {
  const merged = [...configuredModels];

  llamaCppRunningModels.forEach(model => {
    if (!merged.some(existing => sameModelIdentity(existing, model))) {
      merged.push(model);
    }
  });

  return merged;
}

export async function collectAvailableModels(config: AppConfig): Promise<Model[]> {
  const configuredModels = buildConfiguredAvailableModels(config);
  const llamaCppEnabled = isProviderEnabled(
    ProviderName.LlamaCpp,
    config.providers?.[ProviderName.LlamaCpp],
  );
  if (!llamaCppEnabled) {
    return configuredModels;
  }

  try {
    const runningModels = await window.electron.llamacpp.listRunningModels();
    return mergeAvailableModels(configuredModels, buildLlamaCppRunningModels(runningModels));
  } catch {
    return configuredModels;
  }
}

export function notifyLlamaCppRunningModelsChanged(): void {
  window.dispatchEvent(new CustomEvent(LLAMACPP_RUNNING_MODELS_CHANGED_EVENT));
}
