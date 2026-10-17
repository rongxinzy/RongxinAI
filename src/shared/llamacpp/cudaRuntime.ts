import { LlamaCppRuntimeCudaMajor } from './constants';

/** Minimum NVIDIA driver major version that typically supports CUDA 13 runtimes. */
export const LLAMACPP_CUDA13_MIN_DRIVER_MAJOR = 580;

export function parseNvidiaDriverMajor(driverVersion: string | undefined): number | undefined {
  const trimmed = driverVersion?.trim();
  if (!trimmed) return undefined;
  const major = Number.parseInt(trimmed.split('.')[0] ?? '', 10);
  return Number.isFinite(major) && major > 0 ? major : undefined;
}

export function resolvePreferredLlamaCppRuntimeCudaMajor(input: {
  configured?: (typeof LlamaCppRuntimeCudaMajor)[keyof typeof LlamaCppRuntimeCudaMajor];
  driverVersion?: string;
}): (typeof LlamaCppRuntimeCudaMajor)[keyof typeof LlamaCppRuntimeCudaMajor] {
  if (
    input.configured === LlamaCppRuntimeCudaMajor.Cuda12 ||
    input.configured === LlamaCppRuntimeCudaMajor.Cuda13
  ) {
    return input.configured;
  }
  const driverMajor = parseNvidiaDriverMajor(input.driverVersion);
  if (driverMajor !== undefined && driverMajor >= LLAMACPP_CUDA13_MIN_DRIVER_MAJOR) {
    return LlamaCppRuntimeCudaMajor.Cuda13;
  }
  return LlamaCppRuntimeCudaMajor.Cuda12;
}

export function isLikelyCudaDriverMismatchError(message: string | undefined): boolean {
  if (!message?.trim()) return false;
  return /cuda.*driver|cudart|cublas|cuda version|unsupported.*cuda|cuda.*(?:failed|error|incompatible)/i.test(
    message,
  );
}
