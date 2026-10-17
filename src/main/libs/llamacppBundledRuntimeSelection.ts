import { createHash } from 'crypto';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

import type { LlamaCppBackendRef } from '../../shared/llamacpp';

import {
  buildLlamaCppServeEnv,
  isGpuLikeRuntimeDevice,
  parseLlamaCppListDevicesOutput,
} from './llamacppServe';
import {
  type BundledRuntimeManifest,
  resolveBundledLlamaCppRuntimeRoot,
  resolveBundledLlamaCppExecutablePath,
} from './llamacppBundledRuntime';

const gpuProbeCache = new Map<string, boolean>();

function execFileAsync(
  file: string,
  args: string[],
  options: Parameters<typeof execFile>[2],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

export type ResolvedBundledRuntime = {
  executablePath: string;
  backend: LlamaCppBackendRef;
  accelerator: 'cpu' | 'vulkan' | 'cuda' | 'metal';
};

function verifyBundledSha256(
  manifest: BundledRuntimeManifest,
  relativePath: string,
  sha256Key: 'sha256' | 'vulkanSha256' | 'cpuFallbackSha256',
): string {
  const root = resolveBundledLlamaCppRuntimeRoot();
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Bundled llama.cpp runtime executable is missing: ${relativePath}`);
  }
  const expected = manifest[sha256Key];
  if (expected) {
    const hash = createHash('sha256');
    hash.update(fs.readFileSync(absolute));
    if (hash.digest('hex').toLowerCase() !== expected.trim().toLowerCase()) {
      throw new Error('The bundled llama.cpp runtime failed SHA-256 verification.');
    }
  }
  return absolute;
}

export async function detectUsableBundledVulkanGpu(vulkanExecutablePath: string): Promise<boolean> {
  if (!vulkanExecutablePath || !fs.existsSync(vulkanExecutablePath)) return false;
  const cached = gpuProbeCache.get(vulkanExecutablePath);
  if (cached !== undefined) return cached;
  try {
    const { stdout, stderr } = await execFileAsync(vulkanExecutablePath, ['--list-devices'], {
      env: buildLlamaCppServeEnv(process.env, vulkanExecutablePath, process.platform),
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    const output = [stdout, stderr].filter(Boolean).join('\n');
    const usable = parseLlamaCppListDevicesOutput(output).some(device =>
      isGpuLikeRuntimeDevice(device),
    );
    gpuProbeCache.set(vulkanExecutablePath, usable);
    return usable;
  } catch {
    gpuProbeCache.set(vulkanExecutablePath, false);
    return false;
  }
}

export function clearBundledVulkanGpuProbeCache(): void {
  gpuProbeCache.clear();
}

export async function resolveBundledEditionRuntime(input: {
  manifest: BundledRuntimeManifest;
  preferCpuFallback?: boolean;
  forceCpuPath?: boolean;
  platform?: NodeJS.Platform;
}): Promise<ResolvedBundledRuntime> {
  const manifest = input.manifest;
  const platform = input.platform ?? process.platform;
  const preferCpuFallback = input.preferCpuFallback ?? false;
  const forceCpuPath = input.forceCpuPath ?? false;

  if ((preferCpuFallback || forceCpuPath) && manifest.cpuFallbackExecutable) {
    const executablePath = verifyBundledSha256(
      manifest,
      manifest.cpuFallbackExecutable,
      'cpuFallbackSha256',
    );
    return {
      executablePath,
      backend: normalizeBackendRef(manifest.backend, manifest.cpuFallbackBackend),
      accelerator: 'cpu',
    };
  }

  const vulkanRelative = manifest.vulkanExecutable;
  const cpuRelative = manifest.cpuFallbackExecutable ?? manifest.executable;
  const useVulkanSelection =
    !preferCpuFallback &&
    (platform === 'win32' || platform === 'linux') &&
    typeof vulkanRelative === 'string' &&
    vulkanRelative.length > 0;

  if (useVulkanSelection) {
    const vulkanPath = verifyBundledSha256(manifest, vulkanRelative, 'vulkanSha256');
    if (await detectUsableBundledVulkanGpu(vulkanPath)) {
      return {
        executablePath: vulkanPath,
        backend: normalizeBackendRef(manifest.backend, manifest.vulkanBackend),
        accelerator: 'vulkan',
      };
    }
    if (cpuRelative) {
      const shaKey = manifest.cpuFallbackExecutable ? 'cpuFallbackSha256' : 'sha256';
      const executablePath = verifyBundledSha256(manifest, cpuRelative, shaKey);
      return {
        executablePath,
        backend: normalizeBackendRef(manifest.backend, manifest.cpuFallbackBackend),
        accelerator: 'cpu',
      };
    }
  }

  const executablePath = resolveBundledLlamaCppExecutablePath(manifest, { preferCpuFallback });
  if (!executablePath) {
    throw new Error('Bundled llama.cpp runtime executable is missing from this installation.');
  }
  const accelerator =
    platform === 'darwin' ? 'metal' : manifest.backend.backend.includes('cuda') ? 'cuda' : 'cpu';
  return {
    executablePath,
    backend: normalizeBackendRef(manifest.backend),
    accelerator,
  };
}

function normalizeBackendRef(
  backend: LlamaCppBackendRef | { version: string; backend: string; versionBackend?: string },
  override?: LlamaCppBackendRef,
): LlamaCppBackendRef {
  if (override) return override;
  const versionBackend =
    'versionBackend' in backend && backend.versionBackend
      ? backend.versionBackend
      : `${backend.version}/${backend.backend}`;
  return {
    version: backend.version,
    backend: backend.backend,
    versionBackend,
  };
}

export function isVulkanBackendStartupFailure(detail: string | undefined): boolean {
  if (!detail) return false;
  return /vulkan.*(?:unavailable|not available|failed|missing|not found|unsupported|cannot|could not)/i.test(
    detail,
  );
}
