import {
  assessLlamaCppAgentEligibility,
  type LlamaCppAgentEligibility,
  type LlamaCppRunningModel,
} from '../../shared/llamacpp';
import type { ModelCapabilities } from '../../shared/providers';

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
  supportsImage: false;
  contextWindow?: number;
  contextTokens?: number;
  maxTokens?: number;
  capabilities?: Partial<ModelCapabilities>;
  agentEligibility: LlamaCppAgentEligibility;
};

function normalizePositiveInteger(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function buildLlamaCppRunningModelBinding(
  model: Pick<
    LlamaCppRunningModel,
    'name' | 'model' | 'id' | 'runtime_context_length' | 'trained_context_length' | 'details'
  >,
): LlamaCppRunningModelBinding | null {
  const modelName = model.name?.trim() || model.model?.trim() || model.id?.trim() || '';
  if (!modelName) {
    return null;
  }
  const runtimeContextLength = normalizePositiveInteger(model.runtime_context_length);
  const trainedContextLength = normalizePositiveInteger(
    model.trained_context_length ?? model.details?.context_length,
  );
  const agentEligibility = assessLlamaCppAgentEligibility({
    runtimeContextWindow: runtimeContextLength,
    trainedContextWindow: trainedContextLength,
  });

  return {
    id: modelName,
    name: modelName,
    supportsImage: false,
    ...(runtimeContextLength
      ? {
          contextWindow: runtimeContextLength,
          contextTokens: runtimeContextLength,
          maxTokens: deriveLlamaCppAgentMaxTokens(runtimeContextLength),
        }
      : {}),
    agentEligibility,
  };
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
