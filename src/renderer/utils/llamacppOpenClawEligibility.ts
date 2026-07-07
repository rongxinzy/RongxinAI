import {
  assessLlamaCppOpenClawEligibility,
  type LlamaCppOpenClawEligibility,
  type LlamaCppRunningModel,
} from '../../shared/llamacpp';
import { ProviderName } from '../../shared/providers';
import type { Model } from '../store/slices/modelSlice';

export function getRunningModelOpenClawEligibility(
  runningModel: Pick<
    LlamaCppRunningModel,
    'runtime_context_length' | 'trained_context_length' | 'details'
  >,
): LlamaCppOpenClawEligibility {
  return assessLlamaCppOpenClawEligibility({
    runtimeContextWindow: runningModel.runtime_context_length,
    trainedContextWindow:
      runningModel.trained_context_length ?? runningModel.details?.context_length,
  });
}

export function isLlamaCppModel(model: Pick<Model, 'providerKey'>): boolean {
  return model.providerKey === ProviderName.LlamaCpp;
}

export function getModelOpenClawEligibility(
  model: Pick<
    Model,
    | 'providerKey'
    | 'llamaCppOpenClawEligibility'
    | 'llamaCppRuntimeContextWindow'
    | 'llamaCppTrainedContextWindow'
  >,
): LlamaCppOpenClawEligibility | null {
  if (!isLlamaCppModel(model)) {
    return null;
  }
  return model.llamaCppOpenClawEligibility ?? null;
}

export function isModelSelectableForOpenClaw(
  model: Pick<
    Model,
    | 'providerKey'
    | 'llamaCppOpenClawEligibility'
    | 'llamaCppRuntimeContextWindow'
    | 'llamaCppTrainedContextWindow'
  >,
): boolean {
  const eligibility = getModelOpenClawEligibility(model);
  return eligibility ? eligibility.eligible : true;
}
