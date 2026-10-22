import {
  assessLlamaCppAgentEligibility,
  type LlamaCppAgentEligibility,
  type LlamaCppRunningModel,
} from '../../shared/llamacpp';
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

/** Only running local models carry an eligibility; every other model is unrestricted. */
export function getModelAgentEligibility(
  model: Pick<Model, 'llamaCppAgentEligibility'>,
): LlamaCppAgentEligibility | null {
  return model.llamaCppAgentEligibility ?? null;
}
