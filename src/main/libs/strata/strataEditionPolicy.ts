import { InferenceEdition } from '../../../shared/inferenceEdition';
import { resolveEffectiveInferenceEdition } from '../inferenceEditionPolicy';
import { readStrataBundledManifest, resolveStrataBundledRoot } from './strataBundledManifest';

/** Strata is bundled only on Windows CUDA installers (dual-engine with llama.cpp). */
export function isStrataFeatureEnabled(): boolean {
  if (process.platform !== 'win32') return false;
  if (resolveEffectiveInferenceEdition() !== InferenceEdition.Cuda) return false;
  return Boolean(resolveStrataBundledRoot() && readStrataBundledManifest());
}
