import {
  assessLlamaCppAgentEligibility,
  type LlamaCppAgentEligibility,
  type LlamaCppRunningModel,
} from '../../shared/llamacpp';
import { ProviderName } from '../../shared/providers';
import type { Model } from '../store/slices/modelSlice';

export function getRunningModelAgentEligibility(
  runningModel: Pick<
    LlamaCppRunningModel,
    'runtime_context_length' | 'trained_context_length' | 'details'
  >,
): LlamaCppAgentEligibility {
  return assessLlamaCppAgentEligibility({
    runtimeContextWindow: runningModel.runtime_context_length,
    trainedContextWindow:
      runningModel.trained_context_length ?? runningModel.details?.context_length,
  });
}

function isLlamaCppModel(model: Pick<Model, 'providerKey'>): boolean {
  return model.providerKey === ProviderName.LlamaCpp;
}

export function getModelAgentEligibility(
  model: Pick<
    Model,
    | 'providerKey'
    | 'llamaCppAgentEligibility'
    | 'llamaCppRuntimeContextWindow'
    | 'llamaCppTrainedContextWindow'
  >,
): LlamaCppAgentEligibility | null {
  if (!isLlamaCppModel(model)) {
    return null;
  }
  return model.llamaCppAgentEligibility ?? null;
}
