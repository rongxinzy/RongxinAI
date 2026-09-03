import type { DiscoveredProviderModel } from '../../../shared/providers';

type OllamaRuntimeModel = {
  name?: string;
  model?: string;
  id?: string;
  context_length?: number;
};

export function resolveOllamaRunningModelContext(
  modelId: string,
  runningModels: readonly OllamaRuntimeModel[],
): number | undefined {
  const normalizedModelId = modelId.trim().toLowerCase();
  if (!normalizedModelId) return undefined;

  const runningModel = runningModels.find(model =>
    [model.name, model.model, model.id].some(
      candidate => candidate?.trim().toLowerCase() === normalizedModelId,
    ),
  );
  const contextLength = runningModel?.context_length;
  return typeof contextLength === 'number' && Number.isFinite(contextLength) && contextLength > 0
    ? contextLength
    : undefined;
}

export function resolveDiscoveredModelContext(
  modelId: string,
  discoveredModels: readonly DiscoveredProviderModel[],
): number | undefined {
  const normalizedModelId = modelId.trim().toLowerCase();
  if (!normalizedModelId) return undefined;

  const contextWindow = discoveredModels.find(
    model => model.id.trim().toLowerCase() === normalizedModelId,
  )?.contextWindow;
  return typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0
    ? contextWindow
    : undefined;
}
