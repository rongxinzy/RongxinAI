import {
  assessLlamaCppAgentEligibility,
  type LlamaCppAgentEligibility,
  type LlamaCppModelPreferences,
  type LlamaCppRunningModel,
} from '../../shared/llamacpp';

export type { LlamaCppAgentEligibility } from '../../shared/llamacpp';
export {
  assessLlamaCppAgentEligibility,
  LLAMACPP_AGENT_MIN_CONTEXT_WINDOW,
  LlamaCppAgentEligibilityReason,
} from '../../shared/llamacpp';

const LLAMACPP_MIN_AGENT_MAX_TOKENS = 512;
const LLAMACPP_MAX_AGENT_MAX_TOKENS = 4096;
const LLAMACPP_OUTPUT_TOKEN_RATIO = 0.25;

export type LlamaCppRunningModelBinding = {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  agentEligibility: LlamaCppAgentEligibility;
};

export interface LocalGpuSnapshot {
  baseUrl: string | null;
  models: readonly LlamaCppRunningModelBinding[];
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function buildLlamaCppRunningModelBinding(
  model: Pick<
    LlamaCppRunningModel,
    'name' | 'model' | 'id' | 'runtime_context_length' | 'trained_context_length' | 'details'
  >,
  preferences?: LlamaCppModelPreferences,
): LlamaCppRunningModelBinding | null {
  const modelName = model.name?.trim() || model.model?.trim() || model.id?.trim() || '';
  if (!modelName) {
    return null;
  }
  const runtimeContextLength = normalizePositiveInteger(model.runtime_context_length);
  const trainedContextLength = normalizePositiveInteger(
    model.trained_context_length ?? model.details?.context_length,
  );
  const preference = preferences?.[modelName];
  const contextWindow = runtimeContextLength
    ? Math.min(runtimeContextLength, preference?.ctxSize ?? runtimeContextLength)
    : undefined;

  return {
    id: modelName,
    name: modelName,
    ...(contextWindow
      ? {
          contextWindow,
          maxTokens: Math.min(
            preference?.maxTokens ?? deriveLlamaCppAgentMaxTokens(contextWindow),
            contextWindow,
          ),
        }
      : {}),
    agentEligibility: assessLlamaCppAgentEligibility({
      runtimeContextWindow: contextWindow,
      trainedContextWindow: trainedContextLength,
    }),
  };
}

export function buildLlamaCppRunningModelBindings(
  models: readonly LlamaCppRunningModel[],
  preferences: LlamaCppModelPreferences,
): LlamaCppRunningModelBinding[] {
  return models
    .map(model => buildLlamaCppRunningModelBinding(model, preferences))
    .filter((model): model is LlamaCppRunningModelBinding => model !== null);
}

export function deriveLlamaCppAgentMaxTokens(runtimeContextLength: number): number {
  if (!Number.isFinite(runtimeContextLength) || runtimeContextLength <= 0) {
    return LLAMACPP_MIN_AGENT_MAX_TOKENS;
  }

  return Math.max(
    LLAMACPP_MIN_AGENT_MAX_TOKENS,
    Math.min(
      LLAMACPP_MAX_AGENT_MAX_TOKENS,
      Math.floor(runtimeContextLength * LLAMACPP_OUTPUT_TOKEN_RATIO),
    ),
  );
}
