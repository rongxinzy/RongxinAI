import type { LlamaCppModelPreferences, LlamaCppRunningModel } from '../../shared/llamacpp';
import {
  ManagedProviderAccessMode,
  OPEN_MANAGED_PROVIDER_ACCESS_POLICY,
  type ManagedProviderAccessPolicy,
} from '../../shared/managedProviders';
import {
  createProviderConnectionTestSignature,
  isCurrentModelAvailableTest,
  isProviderEnabled,
  ModelCapabilityStatus,
  ProviderName,
  ProviderRegistry,
  resolveCodingPlanBaseUrl,
  resolveConfiguredProviderModels,
  resolveModelEndpoint,
} from '../../shared/providers';
import { type AppConfig, getProviderDisplayName } from '../config';
import type { Model } from '../store/slices/modelSlice';
import { getRunningModelAgentEligibility } from '../utils/llamacppAgentEligibility';
import { ZhiyuanModelPool } from '../../shared/modelPool/constants';
import { i18nService } from './i18n';

export const LLAMACPP_RUNNING_MODELS_CHANGED_EVENT = 'llamacpp:running-models-changed';

type ModelLike = Pick<Model, 'id' | 'providerKey'>;

const sameModelIdentity = (modelA: ModelLike, modelB: ModelLike): boolean =>
  modelA.id === modelB.id && (modelA.providerKey ?? '') === (modelB.providerKey ?? '');

export function buildConfiguredAvailableModels(
  config: AppConfig,
  allowedProviderKeys?: ReadonlySet<string>,
  hiddenModelKeys?: ReadonlySet<string>,
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
    if (providerName === ProviderName.Zhiyuan) {
      return;
    }
    if (!isProviderEnabled(providerName, providerConfig)) {
      return;
    }

    const providerDefinition = ProviderRegistry.get(providerName);
    const configuredModels = resolveConfiguredProviderModels(providerName, providerConfig);
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
      const modelKey = `${providerName}::${model.id}`;
      if (hiddenModelKeys?.has(modelKey)) {
        return;
      }

      const toggleSupportsImage = ProviderRegistry.resolveModelSupportsImage(
        providerName,
        model.id,
        model.supportsImage,
      );
      const capabilities = resolveModelEndpoint(providerName, model.id, {
        providerConfig,
        apiFormat: effectiveApiFormat,
        modelConfig: model,
      }).capabilities;
      // The endpoint layer treats an explicit imageInput capability as
      // authoritative over a stale persisted toggle; the cowork attach gate
      // follows the same verdict so UI gating cannot diverge from requests.
      const supportsImage =
        capabilities.imageInput === ModelCapabilityStatus.Supported
          ? true
          : capabilities.imageInput === ModelCapabilityStatus.Unsupported
            ? false
            : toggleSupportsImage;
      models.push({
        id: model.id,
        name: model.name,
        provider: getProviderDisplayName(providerName, providerConfig),
        providerKey: providerName,
        agentProviderId: ProviderRegistry.getAgentProviderId(providerName),
        supportsImage,
        capabilities,
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

export function buildZhiyuanManagedModels(): Model[] {
  return ProviderRegistry.getModels(ProviderName.Zhiyuan, ZhiyuanModelPool.FreeModelId).map(
    model => ({
      id: model.id,
      name: i18nService.t('zhiyuanFreeModel'),
      provider: i18nService.t('zhiyuanFreeModel'),
      providerKey: ProviderName.Zhiyuan,
      agentProviderId: ProviderRegistry.getAgentProviderId(ProviderName.Zhiyuan),
      supportsImage: model.supportsImage,
      capabilities: ProviderRegistry.resolveModelCapabilities(
        ProviderName.Zhiyuan,
        model.id,
        'openai',
        model,
      ),
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    }),
  );
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

// Identity keys (`providerKey::modelId`) of every model present in the stored
// config, ignoring enabled/test gates. Selections pointing at keys absent from
// this set belong to models deleted from storage for good and can be pruned;
// temporarily hidden models (provider disabled, pending connection test) keep
// theirs. llama.cpp and the managed pool are dynamic sources not governed by
// the stored model list, so they are excluded.
export function collectConfiguredModelKeys(config: AppConfig): string[] {
  const keys: string[] = [];
  if (!config.providers) return keys;

  Object.entries(config.providers).forEach(([providerName, providerConfig]) => {
    if (providerName === ProviderName.LlamaCpp || providerName === ProviderName.Zhiyuan) return;
    const configuredModels = resolveConfiguredProviderModels(providerName, providerConfig);
    configuredModels?.forEach(model => {
      keys.push(`${providerName}::${model.id}`);
    });
  });

  return keys;
}

async function buildHiddenConfiguredModelKeys(
  config: AppConfig,
  allowedProviderKeys?: ReadonlySet<string>,
  managedProviderKeys?: ReadonlySet<string>,
): Promise<Set<string>> {
  const hiddenModelKeys = new Set<string>();
  if (!config.providers) return hiddenModelKeys;

  for (const [providerName, providerConfig] of Object.entries(config.providers)) {
    if (allowedProviderKeys && !allowedProviderKeys.has(providerName)) continue;
    // Managed provider access is gated by host entitlement, not by a user connection test;
    // the managed projection never carries connectionTest metadata.
    if (managedProviderKeys?.has(providerName)) continue;
    if (
      providerName === ProviderName.LlamaCpp ||
      providerName === ProviderName.Zhiyuan ||
      !isProviderEnabled(providerName, providerConfig)
    ) {
      continue;
    }

    const providerDefinition = ProviderRegistry.get(providerName);
    const configuredModels = resolveConfiguredProviderModels(providerName, providerConfig);
    if (!configuredModels?.length) continue;

    const configuredApiFormat =
      providerConfig.apiFormat ?? providerDefinition?.defaultApiFormat ?? 'anthropic';
    const effectiveApiFormat =
      providerConfig.codingPlanEnabled &&
      (configuredApiFormat === 'anthropic' || configuredApiFormat === 'openai')
        ? resolveCodingPlanBaseUrl(providerName, true, configuredApiFormat, providerConfig.baseUrl)
            .effectiveFormat
        : configuredApiFormat;
    const signature = await createProviderConnectionTestSignature({
      providerId: providerName,
      baseUrl: providerConfig.baseUrl,
      apiFormat: effectiveApiFormat,
      provider: providerConfig,
    });

    configuredModels.forEach(model => {
      const connectionTest = 'connectionTest' in model ? model.connectionTest : undefined;
      if (!isCurrentModelAvailableTest({ connectionTest }, signature)) {
        hiddenModelKeys.add(`${providerName}::${model.id}`);
      }
    });
  }

  return hiddenModelKeys;
}
export async function collectAvailableModels(config: AppConfig): Promise<Model[]> {
  const policy = await getManagedProviderAccessPolicy();
  const managedProviderKeys = new Set(policy.providerKeys);
  const allowedProviderKeys =
    policy.mode === ManagedProviderAccessMode.Exclusive ? managedProviderKeys : undefined;
  const hiddenModelKeys = await buildHiddenConfiguredModelKeys(
    config,
    allowedProviderKeys,
    managedProviderKeys,
  );
  const configuredModels = buildConfiguredAvailableModels(
    config,
    allowedProviderKeys,
    hiddenModelKeys,
  );

  if (policy.mode === ManagedProviderAccessMode.Exclusive) return configuredModels;

  let zhiyuanModels: Model[] = [];
  try {
    const models = await window.electron.modelPool?.listModels();
    if (models?.ok && models.models.includes(ZhiyuanModelPool.FreeModelId)) {
      zhiyuanModels = buildZhiyuanManagedModels();
    }
  } catch {
    // Model Pool availability is optional; user-configured and local models remain usable.
  }

  try {
    const runningModels = await window.electron.llamacpp.listRunningModels();
    let preferences: LlamaCppModelPreferences = {};
    try {
      preferences = (await window.electron.llamacpp.getModelPreferences?.()) ?? {};
    } catch {
      // Model preferences are optional metadata; keep the running model list available.
    }
    return mergeAvailableModels(
      [...zhiyuanModels, ...configuredModels],
      buildLlamaCppRunningModels(runningModels, preferences),
    );
  } catch {
    return [...zhiyuanModels, ...configuredModels];
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
