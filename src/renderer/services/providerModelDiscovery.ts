import type {
  DiscoveredProviderModel,
  ProviderConfig,
  ProviderModelDiscoveryResult,
} from '@shared/providers';

export type ProviderModel = NonNullable<ProviderConfig['models']>[number];

export interface AppliedProviderModelDiscovery {
  models: ProviderModel[];
  addedCount: number;
  changed: boolean;
}

export function mergeDiscoveredProviderModels(
  currentModels: ProviderModel[],
  discoveredModels: readonly DiscoveredProviderModel[],
): AppliedProviderModelDiscovery {
  const knownIds = new Set(currentModels.map(model => model.id));
  const addedModels: ProviderModel[] = [];
  for (const discovered of discoveredModels) {
    if (knownIds.has(discovered.id)) continue;
    knownIds.add(discovered.id);
    addedModels.push({
      id: discovered.id,
      name: discovered.displayName?.trim() || discovered.id,
    });
  }

  if (addedModels.length === 0) {
    return { models: currentModels, addedCount: 0, changed: false };
  }
  return {
    models: [...currentModels, ...addedModels],
    addedCount: addedModels.length,
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
