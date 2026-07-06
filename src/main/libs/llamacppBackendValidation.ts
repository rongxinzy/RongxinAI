import type { LlamaCppBackendRef, LlamaCppRuntimeDevice } from '../../shared/llamacpp';

export function backendRequiresDeviceValidation(ref: LlamaCppBackendRef): boolean {
  return ref.backend.includes('cuda')
    || ref.backend.includes('vulkan')
    || ref.backend.includes('hip')
    || ref.backend.includes('opencl-adreno');
}

export function validateBackendDevices(
  ref: LlamaCppBackendRef,
  devices: LlamaCppRuntimeDevice[],
): string | undefined {
  if (ref.backend.includes('cuda')) {
    return devices.some(device => device.backend === 'cuda')
      ? undefined
      : 'The selected CUDA backend did not detect any CUDA devices.';
  }
  if (ref.backend.includes('vulkan')) {
    return devices.some(device => device.backend === 'vulkan')
      ? undefined
      : 'The selected Vulkan backend did not detect any Vulkan devices.';
  }
  if (ref.backend.includes('hip')) {
    return devices.some(device => device.backend === 'rocm')
      ? undefined
      : 'The selected HIP backend did not detect any HIP/ROCm devices.';
  }
  if (ref.backend.includes('opencl-adreno')) {
    return devices.some(device =>
      device.backend === 'opencl' || /adreno/i.test(device.name) || /adreno/i.test(device.id)
    )
      ? undefined
      : 'The selected OpenCL Adreno backend did not detect any Adreno/OpenCL devices.';
  }
  return undefined;
}

