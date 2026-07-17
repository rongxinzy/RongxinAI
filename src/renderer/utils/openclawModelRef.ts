import { OpenClawProviderId, ProviderName, ProviderRegistry } from '@shared/providers/constants';

import type { Model } from '../store/slices/modelSlice';

type ModelRefInput = Pick<Model, 'id' | 'providerKey' | 'openClawProviderId' | 'isServerModel'>;

function resolveModelOpenClawProviderId(model: ModelRefInput): string {
  if (model.isServerModel) {
    return OpenClawProviderId.ZhiyuanServer;
  }
  return model.openClawProviderId || ProviderRegistry.getOpenClawProviderId(model.providerKey ?? '');
}

export function toOpenClawModelRef(model: ModelRefInput): string {
  return `${resolveModelOpenClawProviderId(model)}/${model.id}`;
}

export function matchesOpenClawModelRef(
  modelRef: string,
  model: ModelRefInput,
): boolean {
  const normalizedRef = modelRef.trim();
  if (!normalizedRef) return false;
  if (normalizedRef.includes('/')) {
    return normalizedRef === toOpenClawModelRef(model);
  }
  return normalizedRef === model.id;
}

export function resolveOpenClawModelRef<T extends ModelRefInput>(
  modelRef: string,
  availableModels: T[],
): T | null {
  const normalizedRef = modelRef.trim();
  if (!normalizedRef) return null;

  if (normalizedRef.includes('/')) {
    const exact = availableModels.find((model) => toOpenClawModelRef(model) === normalizedRef) ?? null;
    if (exact) return exact;

    console.log('[openclawModelRef] exact match failed for', normalizedRef, 'available refs:', availableModels.map(m => toOpenClawModelRef(m)));

    const slashIndex = normalizedRef.indexOf('/');
    const providerId = normalizedRef.slice(0, slashIndex);
    const modelId = normalizedRef.slice(slashIndex + 1);

    // OpenAI → OpenAICodex provider migration compatibility
    if (providerId === OpenClawProviderId.OpenAI) {
      const codexMatch = availableModels.find((model) => (
        model.id === modelId
        && model.providerKey === ProviderName.OpenAI
        && resolveModelOpenClawProviderId(model) === OpenClawProviderId.OpenAICodex
      )) ?? null;
      if (codexMatch) return codexMatch;
    }

    // Generic provider fallback: match by model ID if unique
    const idMatches = availableModels.filter((model) => model.id === modelId);
    if (idMatches.length === 1) {
      console.log('[openclawModelRef] provider fallback: resolved', normalizedRef, 'to', toOpenClawModelRef(idMatches[0]));
      return idMatches[0];
    }
    return null;
  }

  const matchingModels = availableModels.filter((model) => model.id === normalizedRef);
  return matchingModels.length === 1 ? matchingModels[0] : null;
}
