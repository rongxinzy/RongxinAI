import type { LlamaCppModelPreferences, LlamaCppRunningModel } from '../../shared/llamacpp';
import type { ExternalModel } from '../../shared/externalModels';
import {
  isProviderEnabled,
  ModelCapabilityStatus,
  ProviderName,
  ProviderRegistry,
  resolveCodingPlanBaseUrl,
} from '../../shared/providers';
import { type AppConfig, getProviderDisplayName } from '../config';
import type { Model } from '../store/slices/modelSlice';
import { getRunningModelAgentEligibility } from '../utils/llamacppAgentEligibility';

export const LLAMACPP_RUNNING_MODELS_CHANGED_EVENT = 'llamacpp:running-models-changed';

type ModelLike = Pick<Model, 'id' | 'providerKey'>;

const sameModelIdentity = (modelA: ModelLike, modelB: ModelLike): boolean =>
  modelA.id === modelB.id && (modelA.providerKey ?? '') === (modelB.providerKey ?? '');

export function buildConfiguredAvailableModels(config: AppConfig): Model[] {
  const models: Model[] = [];

  if (!config.providers) {
    return [];
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
        agentProviderId: ProviderRegistry.getAgentProviderId(providerName),
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

  return [];
}

export function buildLlamaCppRunningModels(
  runningModels: LlamaCppRunningModel[],
  preferences: LlamaCppModelPreferences = {},
): Model[] {
  const models: Model[] = [];

  runningModels.forEach(model => {
    const name = model.name?.trim() || model.model?.trim() || model.id?.trim() || '';
    if (!name) {
      return;
    }
    const eligibility = getRunningModelAgentEligibility(model);
    models.push({
      id: name,
      name,
      provider: 'llama.cpp',
      providerKey: ProviderName.LlamaCpp,
      agentProviderId: ProviderRegistry.getAgentProviderId(ProviderName.LlamaCpp),
      supportsImage: false,
      capabilities: preferences[name]?.capabilities,
      supportsThinkingToggle: model.supportsThinkingToggle,
      llamaCppAgentEligibility: eligibility,
      llamaCppRuntimeContextWindow: eligibility.runtimeContextWindow,
      llamaCppTrainedContextWindow: eligibility.trainedContextWindow,
    });
  });

  return models;
}

export function buildExternalAvailableModels(models: readonly ExternalModel[]): Model[] {
  return [...models]
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault))
    .map(model => ({
      id: model.id,
      name: model.displayName,
      provider: model.provider.displayName,
      providerKey: model.provider.id,
      agentProviderId: model.provider.id,
      supportsImage: model.capabilities?.imageInput === ModelCapabilityStatus.Supported,
      capabilities: model.capabilities,
      contextWindow: model.contextWindow,
    }));
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
  const externalModelsPromise =
    window.electron.externalModels?.list().catch((): readonly ExternalModel[] => []) ??
    Promise.resolve([]);

  try {
    const [runningModels, externalModels] = await Promise.all([
      window.electron.llamacpp.listRunningModels(),
      externalModelsPromise,
    ]);
    let preferences: LlamaCppModelPreferences = {};
    try {
      preferences = (await window.electron.llamacpp.getModelPreferences?.()) ?? {};
    } catch {
      // Model preferences are optional metadata; keep the running model list available.
    }
    return mergeAvailableModels(
      mergeAvailableModels(
        configuredModels,
        buildLlamaCppRunningModels(runningModels, preferences),
      ),
      buildExternalAvailableModels(externalModels),
    );
  } catch {
    return mergeAvailableModels(
      configuredModels,
      buildExternalAvailableModels(await externalModelsPromise),
    );
  }
}

export function notifyLlamaCppRunningModelsChanged(): void {
  window.dispatchEvent(new CustomEvent(LLAMACPP_RUNNING_MODELS_CHANGED_EVENT));
}
