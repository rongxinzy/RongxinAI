import { InferenceEdition, isLocalInferenceEnabledForEdition } from '../../shared/inferenceEdition';

export function shouldShowLocalInferenceNavigation(
  isChatMode: boolean,
  managedModelsOnly: boolean,
  inferenceEdition: InferenceEdition = InferenceEdition.Cpu,
): boolean {
  if (!isLocalInferenceEnabledForEdition(inferenceEdition)) return false;
  return !isChatMode && !managedModelsOnly;
}
