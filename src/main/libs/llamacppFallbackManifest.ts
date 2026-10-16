import type { LlamaCppBackendManifest, LlamaCppBackendManifestEntry } from '../../shared/llamacpp';
import { LlamaCppRuntimeTargetId } from './llamacppRuntimeConstants';

export const DEFAULT_RUNTIME_VERSION = 'b9518';
export const DEFAULT_RELEASE_BASE_URL = 'https://rongxinai.krli.org/llamacpp';

export function buildFallbackManifest(version = DEFAULT_RUNTIME_VERSION): LlamaCppBackendManifest {
  return {
    schemaVersion: 1,
    defaultVersion: version,
    releaseBaseUrl: `${DEFAULT_RELEASE_BASE_URL}/${version}`,
    backends: [
      createFallbackEntry(
        version,
        LlamaCppRuntimeTargetId.WinX64,
        'win32',
        'x64',
        'cpu',
        `llama-${version}-bin-win-cpu-x64.tar.gz`,
      ),
      {
        ...createFallbackEntry(
          version,
          LlamaCppRuntimeTargetId.WinX64Cuda12,
          'win32',
          'x64',
          'cuda',
          `llama-${version}-bin-win-cuda-12.4-x64.tar.gz`,
        ),
        cudaMajor: '12',
        companions: [
          {
            assetName: `cudart-llama-bin-win-cuda-12.4-x64.tar.gz`,
            url: `${DEFAULT_RELEASE_BASE_URL}/${version}/cudart-llama-bin-win-cuda-12.4-x64.tar.gz`,
          },
        ],
      },
      {
        ...createFallbackEntry(
          version,
          'win-x64-cuda-13',
          'win32',
          'x64',
          'cuda',
          `llama-${version}-bin-win-cuda-13.3-x64.tar.gz`,
        ),
        cudaMajor: '13',
        companions: [
          {
            assetName: `cudart-llama-bin-win-cuda-13.3-x64.tar.gz`,
            url: `${DEFAULT_RELEASE_BASE_URL}/${version}/cudart-llama-bin-win-cuda-13.3-x64.tar.gz`,
          },
        ],
      },
      createFallbackEntry(
        version,
        'win-x64-vulkan',
        'win32',
        'x64',
        'vulkan',
        `llama-${version}-bin-win-vulkan-x64.tar.gz`,
      ),
      createFallbackEntry(
        version,
        'win-x64-hip',
        'win32',
        'x64',
        'hip',
        `llama-${version}-bin-win-hip-radeon-x64.tar.gz`,
      ),
      createFallbackEntry(
        version,
        LlamaCppRuntimeTargetId.WinArm64,
        'win32',
        'arm64',
        'cpu',
        `llama-${version}-bin-win-cpu-arm64.tar.gz`,
      ),
      createFallbackEntry(
        version,
        'win-arm64-opencl-adreno',
        'win32',
        'arm64',
        'cpu',
        `llama-${version}-bin-win-opencl-adreno-arm64.tar.gz`,
      ),
      createFallbackEntry(
        version,
        LlamaCppRuntimeTargetId.MacX64,
        'darwin',
        'x64',
        'cpu',
        `llama-${version}-bin-macos-x64.tar.gz`,
      ),
      createFallbackEntry(
        version,
        LlamaCppRuntimeTargetId.MacArm64,
        'darwin',
        'arm64',
        'cpu',
        `llama-${version}-bin-macos-arm64.tar.gz`,
      ),
      createFallbackEntry(
        version,
        LlamaCppRuntimeTargetId.LinuxX64,
        'linux',
        'x64',
        'cpu',
        `llama-${version}-bin-ubuntu-x64.tar.gz`,
      ),
      createFallbackEntry(
        version,
        LlamaCppRuntimeTargetId.LinuxArm64,
        'linux',
        'arm64',
        'cpu',
        `llama-${version}-bin-ubuntu-arm64.tar.gz`,
      ),
    ],
  };
}

function createFallbackEntry(
  version: string,
  backend: string,
  platform: NodeJS.Platform,
  arch: string,
  accelerator: LlamaCppBackendManifestEntry['accelerator'],
  assetName: string,
): LlamaCppBackendManifestEntry {
  return {
    version,
    backend,
    platform,
    arch,
    accelerator,
    archive: {
      assetName,
      url: `${DEFAULT_RELEASE_BASE_URL}/${version}/${assetName}`,
    },
  };
}
