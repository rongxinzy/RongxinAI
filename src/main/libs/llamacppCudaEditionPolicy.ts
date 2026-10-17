import { InferenceEdition } from '../../shared/inferenceEdition';
import type { NvidiaSmiSnapshot } from '../../shared/hardware';
import { t } from '../i18n';
import { resolveEffectiveInferenceEdition } from './inferenceEditionPolicy';

/** RTX 40-series (Ada) target for the CUDA edition build (sm_89). */
export const LLAMACPP_CUDA_EDITION_COMPUTE_CAPABILITY = '8.9';

export function isRtx40ClassComputeCapability(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  const normalized = value.trim();
  return normalized === LLAMACPP_CUDA_EDITION_COMPUTE_CAPABILITY || normalized.startsWith('8.9');
}

export function primaryGpuSupportsCudaEdition(
  snapshot: NvidiaSmiSnapshot | null | undefined,
): boolean {
  const gpu = snapshot?.gpus?.[0];
  return isRtx40ClassComputeCapability(gpu?.computeCapability);
}

export function resolveCudaEditionGpuMessage(
  snapshot: NvidiaSmiSnapshot | null | undefined,
): string {
  const capability = snapshot?.gpus?.[0]?.computeCapability ?? '?';
  return t('llamacppCudaEditionUnsupportedGpu', {
    capability: String(capability),
    required: LLAMACPP_CUDA_EDITION_COMPUTE_CAPABILITY,
  });
}

export function shouldEnforceCudaEditionGpuPolicy(): boolean {
  return resolveEffectiveInferenceEdition() === InferenceEdition.Cuda;
}
