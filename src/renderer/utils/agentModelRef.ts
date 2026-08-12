import { AgentProviderId, ProviderName, ProviderRegistry } from '@shared/providers/constants';

import type { Model } from '../store/slices/modelSlice';

type ModelRefInput = Pick<Model, 'id' | 'providerKey' | 'agentProviderId'>;

function resolveModelAgentProviderId(model: ModelRefInput): string {
  return (
    model.agentProviderId || ProviderRegistry.getAgentProviderId(model.providerKey ?? '')
  );
}

export function toAgentModelRef(model: ModelRefInput): string {
  return `${resolveModelAgentProviderId(model)}/${model.id}`;
}

export function matchesAgentModelRef(modelRef: string, model: ModelRefInput): boolean {
  const normalizedRef = modelRef.trim();
  if (!normalizedRef) return false;
  if (normalizedRef.includes('/')) {
    return normalizedRef === toAgentModelRef(model);
  }
  return normalizedRef === model.id;
}

export function resolveAgentModelRef<T extends ModelRefInput>(
  modelRef: string,
  availableModels: T[],
): T | null {
  const normalizedRef = modelRef.trim();
  if (!normalizedRef) return null;

  if (normalizedRef.includes('/')) {
    const exact =
      availableModels.find(model => toAgentModelRef(model) === normalizedRef) ?? null;
    if (exact) return exact;

    console.log(
      '[agentModelRef] exact match failed for',
      normalizedRef,
      'available refs:',
      availableModels.map(m => toAgentModelRef(m)),
    );

    const slashIndex = normalizedRef.indexOf('/');
    const providerId = normalizedRef.slice(0, slashIndex);
    const modelId = normalizedRef.slice(slashIndex + 1);

    // OpenAI → OpenAICodex provider migration compatibility
    if (providerId === AgentProviderId.OpenAI) {
      const codexMatch =
        availableModels.find(
          model =>
            model.id === modelId &&
            model.providerKey === ProviderName.OpenAI &&
            resolveModelAgentProviderId(model) === AgentProviderId.OpenAICodex,
        ) ?? null;
      if (codexMatch) return codexMatch;
    }

    // Generic provider fallback: match by model ID if unique
    const idMatches = availableModels.filter(model => model.id === modelId);
    if (idMatches.length === 1) {
      console.log(
        '[agentModelRef] provider fallback: resolved',
        normalizedRef,
        'to',
        toAgentModelRef(idMatches[0]),
      );
      return idMatches[0];
    }
    return null;
  }

  const matchingModels = availableModels.filter(model => model.id === normalizedRef);
  return matchingModels.length === 1 ? matchingModels[0] : null;
}
