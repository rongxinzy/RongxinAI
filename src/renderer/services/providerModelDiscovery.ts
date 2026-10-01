import type {
  DiscoveredProviderModel,
  ProviderConfig,
  ProviderModelDiscoveryResult,
} from '@shared/providers';
import {
  DiscoveryCapabilitiesSource,
  ModelCapabilityStatus,
  ProviderModelOrigin,
  type ModelCapabilities,
} from '@shared/providers';

export type ProviderModel = NonNullable<ProviderConfig['models']>[number];

export interface AppliedProviderModelDiscovery {
  models: ProviderModel[];
  addedCount: number;
  removedCount: number;
  changed: boolean;
}

export interface ProviderModelMergeOptions {
  /**
   * Make the result mirror the discovery response: current entries that the
   * response no longer lists are dropped, except entries the user added or
   * edited through the model form (origin "user").
   */
  pruneMissing?: boolean;
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

  if (discovered.contextWindow !== undefined && next.contextWindow !== discovered.contextWindow) {
    next.contextWindow = discovered.contextWindow;
    changed = true;
  }
  if (next.maxTokens === undefined && discovered.maxTokens !== undefined) {
    next.maxTokens = discovered.maxTokens;
    changed = true;
  }

  const discoveredCapabilities = discovered.capabilities;
  if (discoveredCapabilities) {
    // A runtime probe (llama.cpp /props) measures the loaded model directly, so
    // its verdicts may overwrite a stale stored one — including a downgrade
    // from Supported to Unsupported. Unmarked discovery payloads keep the
    // conservative fill-only-missing behavior.
    const probeSourced = discovered.capabilitiesSource === DiscoveryCapabilitiesSource.RuntimeProbe;
    const currentCapabilities: MutableModelCapabilities = { ...next.capabilities };
    let capabilitiesChanged = false;
    for (const key of MODEL_CAPABILITY_KEYS) {
      const discoveredStatus = discoveredCapabilities[key];
      const currentStatus = currentCapabilities[key];
      if (!discoveredStatus || discoveredStatus === ModelCapabilityStatus.Unknown) continue;
      if (
        !currentStatus ||
        currentStatus === ModelCapabilityStatus.Unknown ||
        (probeSourced && currentStatus !== discoveredStatus)
      ) {
        currentCapabilities[key] = discoveredStatus;
        changed = true;
        capabilitiesChanged = true;
      }
    }
    if (capabilitiesChanged) {
      next.capabilities = currentCapabilities;
    }
    const discoveredImageInput = discoveredCapabilities.imageInput;
    if (discoveredImageInput && discoveredImageInput !== ModelCapabilityStatus.Unknown) {
      const supportsImage = discoveredImageInput === ModelCapabilityStatus.Supported;
      if (probeSourced ? next.supportsImage !== supportsImage : next.supportsImage === undefined) {
        next.supportsImage = supportsImage;
        changed = true;
      }
    }
  }

  return changed ? next : current;
}

function createDiscoveredProviderModel(discovered: DiscoveredProviderModel): ProviderModel {
  const imageCapability = discovered.capabilities?.imageInput;
  return {
    id: discovered.id,
    name: discovered.displayName?.trim() || discovered.id,
    ...(discovered.contextWindow !== undefined ? { contextWindow: discovered.contextWindow } : {}),
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
  options: ProviderModelMergeOptions = {},
): AppliedProviderModelDiscovery {
  const pruneMissing = options.pruneMissing === true;
  const discoveredById = new Map(discoveredModels.map(model => [model.id, model]));
  const knownIds = new Set(currentModels.map(model => model.id));
  const nextModels: ProviderModel[] = [];
  let addedCount = 0;
  let removedCount = 0;
  let changed = false;

  for (const current of currentModels) {
    const discovered = discoveredById.get(current.id);
    if (pruneMissing && !discovered && current.origin !== ProviderModelOrigin.User) {
      removedCount += 1;
      changed = true;
      continue;
    }
    nextModels.push(discovered ? applyDiscoveredMetadata(current, discovered) : current);
    if (discovered && nextModels[nextModels.length - 1] !== current) {
      changed = true;
    }
  }

  for (const discovered of discoveredModels) {
    if (knownIds.has(discovered.id)) continue;
    knownIds.add(discovered.id);
    nextModels.push(createDiscoveredProviderModel(discovered));
    addedCount += 1;
    changed = true;
  }

  if (!changed) {
    return { models: currentModels, addedCount: 0, removedCount: 0, changed: false };
  }
  return {
    models: nextModels,
    addedCount,
    removedCount,
    changed: true,
  };
}

export function applyProviderModelDiscoveryResult(
  currentModels: ProviderModel[],
  result: ProviderModelDiscoveryResult,
): AppliedProviderModelDiscovery {
  if (!result.success || result.models.length === 0) {
    return { models: currentModels, addedCount: 0, removedCount: 0, changed: false };
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
