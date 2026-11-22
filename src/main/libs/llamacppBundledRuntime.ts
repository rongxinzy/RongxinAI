import fs from 'fs';
import path from 'path';

import { app } from 'electron';

import type { LlamaCppBackendRef } from '../../shared/llamacpp';

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
