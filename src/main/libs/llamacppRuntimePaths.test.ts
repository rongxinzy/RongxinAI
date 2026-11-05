import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { NvidiaSmiSnapshot } from '../../shared/hardware';
import { LlamaCppRuntimeBackend } from '../../shared/llamacpp';
import type { BundledRuntimeManifest } from './llamacppBundledRuntime';
import { clearBundledVulkanGpuProbeCache } from './llamacppBundledRuntimeSelection';
import { findLlamaCppExecutable } from './llamacppRuntimePaths';

const mocks = vi.hoisted(() => ({
  root: vi.fn<() => string>(),
  manifest: vi.fn<() => BundledRuntimeManifest | undefined>(),
  bundled: vi.fn(() => true),
  nvidia: vi.fn<() => Promise<NvidiaSmiSnapshot | null>>(),
  hash: vi.fn<() => Promise<string>>(),
  execFile: vi.fn(),
}));

vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => 'unused-user-data' } }));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));
vi.mock('./inferenceEditionPolicy', () => ({
  usesBundledLlamaCppRuntime: mocks.bundled,
  resolveEffectiveInferenceEdition: () => 'cuda',
}));
vi.mock('./llamacppBundledRuntime', () => ({
  readBundledLlamaCppRuntimeManifest: mocks.manifest,
  resolveBundledLlamaCppRuntimeRoot: mocks.root,
}));
vi.mock('./llamacppNvidiaEnvironment', async importOriginal => ({
  ...(await importOriginal<typeof import('./llamacppNvidiaEnvironment')>()),
  getLlamaCppNvidiaSnapshot: mocks.nvidia,
}));
vi.mock('./fileHasher', () => ({ sha256FileStream: mocks.hash }));

const originalPlatform = process.platform;

let root: string;
let manifest: BundledRuntimeManifest;

function nvidiaSnapshot(computeCapability: string): NvidiaSmiSnapshot {
  return {
    source: 'nvidia-smi',
    available: true,
    checkedAt: new Date().toISOString(),
    gpus: [
      {
        index: 0,
        name: 'NVIDIA GPU',
        computeCapability,
        memoryTotalMiB: 8192,
        memoryFreeMiB: 8192,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearBundledVulkanGpuProbeCache();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-executable-'));
  mocks.root.mockReturnValue(root);
  mocks.bundled.mockReturnValue(true);
  mocks.nvidia.mockResolvedValue(null);
  manifest = {
    schemaVersion: 1,
    backend: {
      version: 'b9244',
      backend: 'win-x64-cuda-rtx40-sm89',
      versionBackend: 'b9244/win-x64-cuda-rtx40-sm89',
    },
    executable: 'bin/llama-server.exe',
    cpuFallbackExecutable: 'cpu-fallback/llama-server.exe',
  };
  mocks.manifest.mockImplementation(() => manifest);
  for (const relative of [manifest.executable, manifest.cpuFallbackExecutable!]) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'test-executable');
  }
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

test('router executable lookup selects the bundled CPU fallback without an NVIDIA driver', async () => {
  await expect(findLlamaCppExecutable()).resolves.toBe(
    path.join(root, manifest.cpuFallbackExecutable!),
  );
  expect(mocks.execFile).not.toHaveBeenCalled();
});

test('router executable lookup keeps CUDA on a supported RTX 40 GPU', async () => {
  mocks.nvidia.mockResolvedValue(nvidiaSnapshot('8.9'));
  await expect(findLlamaCppExecutable()).resolves.toBe(path.join(root, manifest.executable));
});

test('the specialized CUDA build uses CPU on an unsupported NVIDIA GPU', async () => {
  mocks.nvidia.mockResolvedValue(nvidiaSnapshot('8.6'));
  await expect(findLlamaCppExecutable()).resolves.toBe(
    path.join(root, manifest.cpuFallbackExecutable!),
  );
});

test('an explicit CPU preference selects the CPU binary even on a supported GPU', async () => {
  mocks.nvidia.mockResolvedValue(nvidiaSnapshot('8.9'));
  await expect(
    findLlamaCppExecutable({ runtimeBackend: LlamaCppRuntimeBackend.Cpu }),
  ).resolves.toBe(path.join(root, manifest.cpuFallbackExecutable!));
});

test('an unsupported CUDA installation without a fallback fails before spawning', async () => {
  delete manifest.cpuFallbackExecutable;
  await expect(findLlamaCppExecutable()).rejects.toThrow();
  expect(mocks.execFile).not.toHaveBeenCalled();
});

test('a missing bundled manifest does not select an unrelated executable', async () => {
  mocks.manifest.mockReturnValue(undefined);
  await expect(findLlamaCppExecutable()).resolves.toBeNull();
});

test('a missing CPU executable fails instead of retrying the incompatible CUDA binary', async () => {
  fs.unlinkSync(path.join(root, manifest.cpuFallbackExecutable!));
  await expect(findLlamaCppExecutable()).rejects.toThrow('runtime executable is missing');
  expect(mocks.execFile).not.toHaveBeenCalled();
});

test.each(['win32', 'linux'] as const)(
  'CPU editions retain manifest-based Vulkan selection on %s',
  async platform => {
    Object.defineProperty(process, 'platform', { value: platform });
    manifest.backend.backend = 'win-x64-cpu-vulkan-bundle';
    manifest.vulkanExecutable = manifest.executable;
    mocks.execFile.mockImplementation((_file, _args, _options, callback) => {
      callback(null, 'Vulkan0: Intel UHD Graphics 770\n', '');
    });
    await expect(findLlamaCppExecutable()).resolves.toBe(
      path.join(root, manifest.vulkanExecutable),
    );
    expect(mocks.nvidia).not.toHaveBeenCalled();
    expect(mocks.execFile).toHaveBeenCalledOnce();
  },
);

test('macOS uses its primary bundled runtime without Vulkan probing', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  manifest.backend.backend = 'mac-arm64';
  manifest.vulkanExecutable = manifest.executable;
  await expect(findLlamaCppExecutable()).resolves.toBe(path.join(root, manifest.executable));
  expect(mocks.nvidia).not.toHaveBeenCalled();
  expect(mocks.execFile).not.toHaveBeenCalled();
});

test('bundled hash verification awaits the worker and rejects a modified CPU executable', async () => {
  manifest.cpuFallbackSha256 = 'a'.repeat(64);
  mocks.hash.mockResolvedValue('b'.repeat(64));
  const readSync = vi.spyOn(fs, 'readFileSync');
  await expect(findLlamaCppExecutable()).rejects.toThrow('SHA-256 verification');
  expect(mocks.hash).toHaveBeenCalledWith(path.join(root, manifest.cpuFallbackExecutable!));
  expect(readSync).not.toHaveBeenCalled();
});

test('bundled hash verification accepts the worker digest', async () => {
  manifest.cpuFallbackSha256 = 'a'.repeat(64);
  mocks.hash.mockResolvedValue(manifest.cpuFallbackSha256);
  await expect(findLlamaCppExecutable()).resolves.toBe(
    path.join(root, manifest.cpuFallbackExecutable!),
  );
});
