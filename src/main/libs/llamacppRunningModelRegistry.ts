import type { LlamaCppAgentEligibility } from './llamacppAgentBinding';

type LlamaCppRunningModelSnapshot = {
  id: string;
  name: string;
  contextWindow?: number;
  agentEligibility?: LlamaCppAgentEligibility;
};

let llamaCppRunningModelCache: LlamaCppRunningModelSnapshot[] = [];

function serializeLlamaCppRunningModels(models: LlamaCppRunningModelSnapshot[]): string {
  return JSON.stringify(
    models
      .map(model => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        agentEligibility: model.agentEligibility,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

export function updateLlamaCppRunningModels(
  models: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    agentEligibility?: LlamaCppAgentEligibility;
  }>,
): boolean {
  const normalized = models
    .map(model => ({
      id: model.id.trim(),
      name: (model.name || model.id).trim(),
      contextWindow: model.contextWindow,
      agentEligibility: model.agentEligibility,
    }))
    .filter(model => model.id);
  const previous = serializeLlamaCppRunningModels(llamaCppRunningModelCache);
  llamaCppRunningModelCache = normalized;
  return previous !== serializeLlamaCppRunningModels(normalized);
}

export function getLlamaCppRunningModels(): LlamaCppRunningModelSnapshot[] {
  return llamaCppRunningModelCache.map(model => ({
    ...model,
    agentEligibility: model.agentEligibility ? { ...model.agentEligibility } : undefined,
  }));
}

function findLlamaCppRunningModel(modelId: string): LlamaCppRunningModelSnapshot | undefined {
  const normalized = modelId.trim();
  if (!normalized) return undefined;
  return llamaCppRunningModelCache.find(model => model.id === normalized);
}

export function isLlamaCppModelRunning(modelId: string): boolean {
  return Boolean(findLlamaCppRunningModel(modelId));
}

export function getLlamaCppModelAgentEligibility(
  modelId: string,
): LlamaCppAgentEligibility | undefined {
  const eligibility = findLlamaCppRunningModel(modelId)?.agentEligibility;
  return eligibility ? { ...eligibility } : undefined;
}
