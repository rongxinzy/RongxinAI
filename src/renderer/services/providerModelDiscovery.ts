import type {
  DiscoveredProviderModel,
  ProviderConfig,
  ProviderModelDiscoveryResult,
} from '@shared/providers';
import { ModelCapabilityStatus, type ModelCapabilities } from '@shared/providers';

export type ProviderModel = NonNullable<ProviderConfig['models']>[number];

export interface AppliedProviderModelDiscovery {
  models: ProviderModel[];
  addedCount: number;
  changed: boolean;
}

const MODEL_CAPABILITY_KEYS = [
  'toolCalling',
  'imageInput',
  'videoInput',
  'audioInput',
  'documentInput',
  'reasoning',
] as const satisfies readonly (keyof ModelCapabilities)[];
type MutableModelCapabilities = {
  -readonly [Key in keyof ModelCapabilities]?: ModelCapabilities[Key];
};

function applyDiscoveredMetadata(
  current: ProviderModel,
  discovered: DiscoveredProviderModel,
): ProviderModel {
  let changed = false;
  const next: ProviderModel = { ...current };

  if (next.contextWindow === undefined && discovered.contextWindow !== undefined) {
    next.contextWindow = discovered.contextWindow;
    changed = true;
  }
  if (next.maxTokens === undefined && discovered.maxTokens !== undefined) {
    next.maxTokens = discovered.maxTokens;
    changed = true;
  }

  const discoveredCapabilities = discovered.capabilities;
  if (discoveredCapabilities) {
    const currentCapabilities: MutableModelCapabilities = { ...next.capabilities };
    let capabilitiesChanged = false;
    for (const key of MODEL_CAPABILITY_KEYS) {
      const discoveredStatus = discoveredCapabilities[key];
      const currentStatus = currentCapabilities[key];
      if (
        discoveredStatus &&
        discoveredStatus !== ModelCapabilityStatus.Unknown &&
        (!currentStatus || currentStatus === ModelCapabilityStatus.Unknown)
      ) {
        currentCapabilities[key] = discoveredStatus;
        changed = true;
        capabilitiesChanged = true;
      }
    }
    if (capabilitiesChanged) {
      next.capabilities = currentCapabilities;
    }
    if (
      next.supportsImage === undefined &&
      discoveredCapabilities.imageInput &&
      discoveredCapabilities.imageInput !== ModelCapabilityStatus.Unknown
    ) {
      next.supportsImage = discoveredCapabilities.imageInput === ModelCapabilityStatus.Supported;
      changed = true;
    }
  }

  return changed ? next : current;
}

function createDiscoveredProviderModel(discovered: DiscoveredProviderModel): ProviderModel {
  const imageCapability = discovered.capabilities?.imageInput;
  return {
    id: discovered.id,
    name: discovered.displayName?.trim() || discovered.id,
    ...(discovered.contextWindow !== undefined
      ? { contextWindow: discovered.contextWindow }
      : {}),
    ...(discovered.maxTokens !== undefined ? { maxTokens: discovered.maxTokens } : {}),
    ...(discovered.capabilities ? { capabilities: discovered.capabilities } : {}),
    ...(imageCapability === ModelCapabilityStatus.Supported
      ? { supportsImage: true }
      : imageCapability === ModelCapabilityStatus.Unsupported
        ? { supportsImage: false }
        : {}),
  };
}

export function mergeDiscoveredProviderModels(
  currentModels: ProviderModel[],
  discoveredModels: readonly DiscoveredProviderModel[],
): AppliedProviderModelDiscovery {
  const knownIds = new Set(currentModels.map(model => model.id));
  const nextModels = [...currentModels];
  let addedCount = 0;
  let changed = false;
  for (const discovered of discoveredModels) {
    const existingIndex = nextModels.findIndex(model => model.id === discovered.id);
    if (existingIndex >= 0) {
      const merged = applyDiscoveredMetadata(nextModels[existingIndex], discovered);
      if (merged !== nextModels[existingIndex]) {
        nextModels[existingIndex] = merged;
        changed = true;
      }
      continue;
    }
    knownIds.add(discovered.id);
    nextModels.push(createDiscoveredProviderModel(discovered));
    addedCount += 1;
    changed = true;
  }

  if (!changed) {
    return { models: currentModels, addedCount: 0, changed: false };
  }
  return {
    models: nextModels,
    addedCount,
    changed: true,
  };
}

export function applyProviderModelDiscoveryResult(
  currentModels: ProviderModel[],
  result: ProviderModelDiscoveryResult,
): AppliedProviderModelDiscovery {
  if (!result.success || result.models.length === 0) {
    return { models: currentModels, addedCount: 0, changed: false };
  }
  return mergeDiscoveredProviderModels(currentModels, result.models);
}

export function isCurrentProviderModelDiscoveryRequest(
  requestId: number,
  latestRequestId: number,
  requestSignature: string,
  currentSignature: string,
): boolean {
  return requestId === latestRequestId && requestSignature === currentSignature;
}
