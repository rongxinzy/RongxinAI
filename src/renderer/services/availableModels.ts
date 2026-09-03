import type { LlamaCppModelPreferences, LlamaCppRunningModel } from '../../shared/llamacpp';
import {
  ManagedProviderAccessMode,
  OPEN_MANAGED_PROVIDER_ACCESS_POLICY,
  type ManagedProviderAccessPolicy,
} from '../../shared/managedProviders';
import {
  isProviderEnabled,
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

export function buildConfiguredAvailableModels(
  config: AppConfig,
  allowedProviderKeys?: ReadonlySet<string>,
): Model[] {
  const models: Model[] = [];

  if (!config.providers) {
    return [];
  }

  Object.entries(config.providers).forEach(([providerName, providerConfig]) => {
    if (allowedProviderKeys && !allowedProviderKeys.has(providerName)) return;
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
      ...(preferences[name]?.maxTokens ? { maxTokens: preferences[name]?.maxTokens } : {}),
      supportsThinkingToggle: model.supportsThinkingToggle,
      llamaCppAgentEligibility: eligibility,
      llamaCppRuntimeContextWindow: preferences[name]?.ctxSize ?? eligibility.runtimeContextWindow,
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
  const policy = await getManagedProviderAccessPolicy();
  const configuredModels = buildConfiguredAvailableModels(
    config,
    policy.mode === ManagedProviderAccessMode.Exclusive ? new Set(policy.providerKeys) : undefined,
  );

  if (policy.mode === ManagedProviderAccessMode.Exclusive) return configuredModels;

  try {
    const runningModels = await window.electron.llamacpp.listRunningModels();
    let preferences: LlamaCppModelPreferences = {};
    try {
      preferences = (await window.electron.llamacpp.getModelPreferences?.()) ?? {};
    } catch {
      // Model preferences are optional metadata; keep the running model list available.
    }
    return mergeAvailableModels(
      configuredModels,
      buildLlamaCppRunningModels(runningModels, preferences),
    );
  } catch {
    return configuredModels;
  }
}

export async function getManagedProviderAccessPolicy(): Promise<ManagedProviderAccessPolicy> {
  return (
    (await window.electron.managedProviders?.policy().catch(() => null)) ??
    OPEN_MANAGED_PROVIDER_ACCESS_POLICY
  );
}

export function notifyLlamaCppRunningModelsChanged(): void {
  window.dispatchEvent(new CustomEvent(LLAMACPP_RUNNING_MODELS_CHANGED_EVENT));
}
