import fs from 'fs';
import path from 'path';

import type { LlamaCppBackendRef } from '../../../shared/llamacpp';
import { resolveLlamaCppExecutableName } from '../llamacppRuntimeInstaller';

export function buildVersionBackend(version: string, backend: string): string {
  return `${version}/${backend}`;
}

export function toBackendRef(version: string, backend: string): LlamaCppBackendRef {
  return {
    version,
    backend,
    versionBackend: buildVersionBackend(version, backend),
  };
}

export function getLlamaCppBackendsRoot(runtimeRoot: string): string {
  return path.join(runtimeRoot, 'backends');
}

export function getLlamaCppBackendDir(runtimeRoot: string, ref: LlamaCppBackendRef): string {
  assertSafeBackendRef(ref);
  return path.join(getLlamaCppBackendsRoot(runtimeRoot), ref.version, ref.backend);
}

export function getLlamaCppBackendDownloadDir(
  runtimeRoot: string,
  ref: LlamaCppBackendRef,
): string {
  assertSafeBackendRef(ref);
  return path.join(runtimeRoot, 'downloads', sanitizePathSegment(ref.versionBackend));
}

export function getLlamaCppCurrentBackendDir(runtimeRoot: string): string {
  return path.join(runtimeRoot, 'current');
}

export function getLlamaCppBackendExecutablePath(
  runtimeRoot: string,
  ref: LlamaCppBackendRef,
  platform: NodeJS.Platform,
): string {
  return resolveManagedBackendExecutablePath(getLlamaCppBackendDir(runtimeRoot, ref), platform);
}

export function getLlamaCppCurrentExecutablePath(
  runtimeRoot: string,
  platform: NodeJS.Platform,
): string {
  return resolveManagedBackendExecutablePath(getLlamaCppCurrentBackendDir(runtimeRoot), platform);
}

export function getManagedBackendBinDir(runtimeDir: string): string {
  return path.join(runtimeDir, 'build', 'bin');
}

export function resolveManagedBackendExecutablePath(
  runtimeDir: string,
  platform: NodeJS.Platform,
): string {
  const executableName = resolveLlamaCppExecutableName(platform);
  const buildBinPath = path.join(runtimeDir, 'build', 'bin', executableName);
  if (fs.existsSync(buildBinPath)) return buildBinPath;
  const flatBinPath = path.join(runtimeDir, 'bin', executableName);
  if (fs.existsSync(flatBinPath)) return flatBinPath;
  const rootPath = path.join(runtimeDir, executableName);
  if (fs.existsSync(rootPath)) return rootPath;
  return buildBinPath;
}

export function removeCurrentBackendLink(runtimeRoot: string): void {
  const currentDir = getLlamaCppCurrentBackendDir(runtimeRoot);
  try {
    const stat = fs.lstatSync(currentDir);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(currentDir);
    } else {
      fs.rmSync(currentDir, { recursive: true, force: true });
    }
  } catch {
    // Missing current backend is valid.
  }
}

function assertSafeBackendRef(ref: LlamaCppBackendRef): void {
  for (const value of [ref.version, ref.backend]) {
    if (!/^[A-Za-z0-9._-]+$/.test(value) || value.includes('..')) {
      throw new Error(`Unsafe llama.cpp backend path segment: ${value}`);
    }
  }
}

export function sanitizePathSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+$/, '_') || 'archive';
}
