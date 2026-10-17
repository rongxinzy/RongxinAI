import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import { app } from 'electron';

import type { LlamaCppBackendRef } from '../../shared/llamacpp';
import { resolveBundledLlamaCppBackendDir } from './llamacppBackendResources';
import { usesBundledLlamaCppRuntime } from './inferenceEditionPolicy';

export const LLAMACPP_BUNDLED_RUNTIME_DIR = 'llamacpp-bundled';

export type BundledRuntimeManifest = {
  schemaVersion: number;
  backend: LlamaCppBackendRef;
  executable: string;
  sha256?: string;
  vulkanExecutable?: string;
  vulkanSha256?: string;
  vulkanBackend?: LlamaCppBackendRef;
  cpuFallbackExecutable?: string;
  cpuFallbackSha256?: string;
  cpuFallbackBackend?: LlamaCppBackendRef;
};

export function resolveBundledLlamaCppRuntimeRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, LLAMACPP_BUNDLED_RUNTIME_DIR);
  }
  const edition = process.env.ZHIYUAN_UPDATE_VARIANT?.trim() || 'cpu';
  return path.join(process.cwd(), 'vendor', 'llamacpp', edition);
}

export function readBundledLlamaCppRuntimeManifest(): BundledRuntimeManifest | undefined {
  const manifestPath = path.join(resolveBundledLlamaCppRuntimeRoot(), 'manifest.json');
  if (!fs.existsSync(manifestPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BundledRuntimeManifest;
  } catch {
    return undefined;
  }
}

export function resolveBundledLlamaCppExecutablePath(
  manifest: BundledRuntimeManifest,
  options: { preferCpuFallback?: boolean } = {},
): string | undefined {
  const root = resolveBundledLlamaCppRuntimeRoot();
  const relative =
    options.preferCpuFallback && manifest.cpuFallbackExecutable
      ? manifest.cpuFallbackExecutable
      : manifest.executable;
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return undefined;
  const expectedSha256 = options.preferCpuFallback ? manifest.cpuFallbackSha256 : manifest.sha256;
  if (expectedSha256 && !verifySha256(absolute, expectedSha256)) {
    throw new Error('The bundled llama.cpp runtime failed SHA-256 verification.');
  }
  return absolute;
}

export function tryResolveActiveBundledLlamaCppRuntime():
  | {
      executablePath: string;
      backend: LlamaCppBackendRef;
    }
  | undefined {
  if (!usesBundledLlamaCppRuntime()) return undefined;
  const manifest = readBundledLlamaCppRuntimeManifest();
  if (!manifest) return undefined;
  const executablePath = resolveBundledLlamaCppExecutablePath(manifest);
  if (!executablePath) return undefined;
  return { executablePath, backend: normalizeBundledBackendRef(manifest.backend) };
}

function normalizeBundledBackendRef(
  backend: LlamaCppBackendRef | { version: string; backend: string; versionBackend?: string },
): LlamaCppBackendRef {
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

export function resolveBundledBackendManifestPath(): string {
  return path.join(resolveBundledLlamaCppBackendDir(), 'manifest.json');
}

function verifySha256(filePath: string, expectedSha256: string): boolean {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex').toLowerCase() === expectedSha256.trim().toLowerCase();
}
