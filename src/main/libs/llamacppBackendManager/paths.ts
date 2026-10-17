import fs from 'fs';
import path from 'path';
import type {
  LlamaCppBackendInfo,
  LlamaCppBackendRef,
  LlamaCppRuntimeInstallResult,
} from '../../../shared/llamacpp';
import { resolveLlamaCppExecutableName } from '../llamacppRuntimeInstaller';

const BUILD_INFO_FILE = 'runtime-build-info.json';

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

export function readCurrentBackendRef(runtimeRoot: string): LlamaCppBackendRef | undefined {
  return readBackendBuildInfo(getLlamaCppCurrentBackendDir(runtimeRoot));
}

export function readBackendBuildInfo(
  runtimeDir: string,
): (LlamaCppBackendRef & Record<string, unknown>) | undefined {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(runtimeDir, BUILD_INFO_FILE), 'utf8'),
    ) as Record<string, unknown>;
    const version = String(parsed.version ?? '').trim();
    const backend = String(parsed.backend ?? parsed.target ?? '').trim();
    if (!version || !backend) return undefined;
    return { ...parsed, ...toBackendRef(version, backend) };
  } catch {
    return undefined;
  }
}

export function syncCurrentBackend(runtimeRoot: string, ref: LlamaCppBackendRef): void {
  const backendDir = getLlamaCppBackendDir(runtimeRoot, ref);
  if (!fs.existsSync(backendDir)) {
    throw new Error(`Backend does not exist: ${ref.versionBackend}`);
  }
  const currentDir = getLlamaCppCurrentBackendDir(runtimeRoot);
  removeCurrentBackendLink(runtimeRoot);
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.symlinkSync(backendDir, currentDir, process.platform === 'win32' ? 'junction' : 'dir');
}

export function listInstalledBackendRefs(
  runtimeRoot: string,
  platform: NodeJS.Platform = process.platform,
): LlamaCppBackendRef[] {
  const backendsRoot = getLlamaCppBackendsRoot(runtimeRoot);
  if (!fs.existsSync(backendsRoot)) return [];
  const refs: LlamaCppBackendRef[] = [];
  for (const versionEntry of fs.readdirSync(backendsRoot, { withFileTypes: true })) {
    if (!versionEntry.isDirectory()) continue;
    for (const backendEntry of fs.readdirSync(path.join(backendsRoot, versionEntry.name), {
      withFileTypes: true,
    })) {
      if (!backendEntry.isDirectory()) continue;
      const ref = toBackendRef(versionEntry.name, backendEntry.name);
      const executablePath = resolveManagedBackendExecutablePath(
        path.join(backendsRoot, ref.version, ref.backend),
        platform,
      );
      if (fs.existsSync(executablePath)) {
        refs.push(ref);
      }
    }
  }
  return refs;
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

export function assertSafeBackendRef(ref: LlamaCppBackendRef): void {
  for (const value of [ref.version, ref.backend]) {
    if (!/^[A-Za-z0-9._-]+$/.test(value) || value.includes('..')) {
      throw new Error(`Unsafe llama.cpp backend path segment: ${value}`);
    }
  }
}

export function sanitizePathSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+$/, '_') || 'archive';
}

export function writeBackendBuildInfo(runtimeDir: string, info: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(runtimeDir, BUILD_INFO_FILE),
    `${JSON.stringify(info, null, 2)}\n`,
    'utf8',
  );
}
