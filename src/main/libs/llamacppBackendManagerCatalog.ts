import fs from 'fs';
import path from 'path';

import type {
  LlamaCppBackendArchivePart,
  LlamaCppBackendInfo,
  LlamaCppBackendManifest,
  LlamaCppBackendManifestEntry,
  LlamaCppBackendRef,
  LlamaCppInstallProgress,
  LlamaCppServiceConfig,
} from '../../shared/llamacpp';
import {
  LlamaCppRuntimeBackend,
  LlamaCppRuntimeCudaMajor,
  resolvePreferredLlamaCppRuntimeCudaMajor,
} from '../../shared/llamacpp';
import { readBundledLlamaCppBackendManifest } from './llamacppBackendResources';
import { LlamaCppRuntimeTargetId } from './llamacppRuntimeConstants';
import {
  buildFallbackManifest,
  DEFAULT_RUNTIME_VERSION,
  DEFAULT_RELEASE_BASE_URL,
} from './llamacppFallbackManifest';
import {
  getLlamaCppBackendDir,
  getLlamaCppBackendExecutablePath,
  getLlamaCppBackendsRoot,
  getLlamaCppCurrentBackendDir,
  getLlamaCppCurrentExecutablePath,
  removeCurrentBackendLink,
  resolveManagedBackendExecutablePath,
  toBackendRef,
} from './llamacppBackendManagerPaths';
import {
  backendDownloadSizeCache,
  BUILD_INFO_FILE,
  compareBackendInfo,
  compareVersionDesc,
  fetchManifestFromUrl,
  findManifestEntry,
  inferBackendAccelerator,
  latestManifestVersion,
  normalizeArch,
  normalizeManifest,
  normalizePlatform,
  resolveArchiveUrl,
  resolveBundledManifestUrl,
  resolvePartUrl,
  setHasLoggedManifestFallback,
  shouldLogManifestFallbackWarning,
  validateBackendForMachine,
} from './llamacppBackendManagerSupport';

export type LlamaCppBackendSelectionInput = {
  platform: NodeJS.Platform;
  arch: string;
  hasNvidiaGpu: boolean;
  config?: LlamaCppServiceConfig;
};

export async function fetchLlamaCppBackendManifest(
  env: NodeJS.ProcessEnv = process.env,
): Promise<LlamaCppBackendManifest> {
  const explicitUrl = env.LLAMACPP_BACKEND_MANIFEST_URL?.trim();
  const version = env.LLAMACPP_RUNTIME_VERSION?.trim() || DEFAULT_RUNTIME_VERSION;
  if (!explicitUrl) {
    const bundledManifest = readBundledLlamaCppBackendManifest();
    if (bundledManifest?.backends.length) {
      return normalizeManifest(bundledManifest, resolveBundledManifestUrl());
    }
  }
  const manifestUrl = explicitUrl || `${DEFAULT_RELEASE_BASE_URL}/manifest.json`;
  try {
    const manifest = await fetchManifestFromUrl(manifestUrl);
    if (manifest.backends.length === 0)
      throw new Error('The backend manifest does not contain any backends.');
    return manifest;
  } catch (error) {
    if (shouldLogManifestFallbackWarning()) {
      console.warn('[LlamaCppBackend] manifest fetch failed, using built-in fallback:', error);
      setHasLoggedManifestFallback();
    } else {
      console.debug(
        '[LlamaCppBackend] manifest fetch failed again, continuing with built-in fallback.',
      );
    }
    return buildFallbackManifest(version);
  }
}

export async function listLlamaCppBackends(input: {
  runtimeRoot: string;
  platform: NodeJS.Platform;
  arch: string;
  hasNvidiaGpu: boolean;
  config?: LlamaCppServiceConfig;
  manifest?: LlamaCppBackendManifest;
}): Promise<{
  backends: LlamaCppBackendInfo[];
  selection?: LlamaCppBackendRef;
  recommended?: LlamaCppBackendRef;
}> {
  const manifest = input.manifest ?? (await fetchLlamaCppBackendManifest());
  const installed = listInstalledBackendRefs(input.runtimeRoot, input.platform);
  const installedKeys = new Set(installed.map(ref => ref.versionBackend));
  const selection = readCurrentBackendRef(input.runtimeRoot);
  const recommended = recommendLlamaCppBackend({
    manifest,
    platform: input.platform,
    arch: input.arch,
    hasNvidiaGpu: input.hasNvidiaGpu,
    config: input.config,
  });

  const remoteInfos = manifest.backends.map(entry => {
    const ref = toBackendRef(entry.version, entry.backend);
    return {
      ...ref,
      platform: normalizePlatform(entry.platform),
      arch: entry.arch,
      accelerator: entry.accelerator,
      cudaMajor: entry.cudaMajor,
      installed: installedKeys.has(ref.versionBackend),
      recommended: recommended?.versionBackend === ref.versionBackend,
      current: selection?.versionBackend === ref.versionBackend,
      source: 'manifest' as const,
      downloadSizeBytes: getBackendDownloadSizeBytes(entry),
    };
  });
  const remoteKeys = new Set(remoteInfos.map(info => info.versionBackend));
  const localInfos = installed
    .filter(ref => !remoteKeys.has(ref.versionBackend))
    .map(ref => {
      const buildInfo = readBackendBuildInfo(getLlamaCppBackendDir(input.runtimeRoot, ref));
      const accelerator = inferBackendAccelerator(ref.backend);
      return {
        ...ref,
        platform: String(buildInfo?.platform ?? input.platform),
        arch: String(buildInfo?.arch ?? input.arch),
        accelerator,
        cudaMajor: ref.backend.includes('cuda-12') ? ('12' as const) : undefined,
        installed: true,
        recommended: recommended?.versionBackend === ref.versionBackend,
        current: selection?.versionBackend === ref.versionBackend,
        source: 'local' as const,
      };
    });
  return {
    backends: [...remoteInfos, ...localInfos].sort(compareBackendInfo),
    selection,
    recommended,
  };
}

function getBackendDownloadSizeBytes(entry: LlamaCppBackendManifestEntry): number | undefined {
  const archiveSize = (archive?: {
    size?: number;
    parts?: LlamaCppBackendArchivePart[];
  }): number | undefined => {
    if (!archive) return undefined;
    if (
      archive.parts?.length &&
      archive.parts.every(part => typeof part.size === 'number' && Number.isFinite(part.size))
    ) {
      return archive.parts.reduce((sum, part) => sum + (part.size ?? 0), 0);
    }
    return Number.isFinite(archive.size) ? archive.size : undefined;
  };
  const sizes = [archiveSize(entry.archive), ...(entry.companions ?? []).map(archiveSize)];
  if (sizes.some(size => size === undefined)) return undefined;
  return (sizes as number[]).reduce((sum, size) => sum + size, 0);
}

export async function resolveLlamaCppBackendDownloadSize(input: {
  ref: LlamaCppBackendRef;
  manifest?: LlamaCppBackendManifest;
}): Promise<number | undefined> {
  const manifest = input.manifest ?? (await fetchLlamaCppBackendManifest());
  const entry = findManifestEntry(manifest, input.ref);
  if (!entry) return undefined;
  const declaredSize = getBackendDownloadSizeBytes(entry);
  if (declaredSize !== undefined) return declaredSize;

  const archives = [entry.archive, ...(entry.companions ?? [])].filter(
    (archive): archive is NonNullable<typeof archive> => Boolean(archive),
  );
  const archiveSizes = await Promise.all(
    archives.map(async archive => {
      if (archive.parts?.length) {
        const partSizes = await Promise.all(
          archive.parts.map(part =>
            resolveRemoteContentLength(resolvePartUrl(part, manifest), part.size),
          ),
        );
        return partSizes.every((size): size is number => size !== undefined)
          ? partSizes.reduce((sum, size) => sum + size, 0)
          : undefined;
      }
      return resolveRemoteContentLength(resolveArchiveUrl(archive, manifest), archive.size);
    }),
  );
  return archiveSizes.every((size): size is number => size !== undefined)
    ? archiveSizes.reduce((sum, size) => sum + size, 0)
    : undefined;
}

async function resolveRemoteContentLength(
  url: string,
  declaredSize?: number,
): Promise<number | undefined> {
  if (typeof declaredSize === 'number' && Number.isFinite(declaredSize)) return declaredSize;
  const cached = backendDownloadSizeCache.get(url);
  if (cached !== undefined) return cached;
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'ZhiYuanAgent/llamacpp-backend-manager' },
    });
    const size = Number(response.headers.get('content-length'));
    if (!response.ok || !Number.isFinite(size) || size <= 0) return undefined;
    backendDownloadSizeCache.set(url, size);
    return size;
  } catch {
    return undefined;
  }
}

export async function getLlamaCppBackendCompatibilityError(input: {
  runtimeRoot: string;
  ref: LlamaCppBackendRef;
  platform: NodeJS.Platform;
  arch: string;
  hasNvidiaGpu: boolean;
  manifest?: LlamaCppBackendManifest;
}): Promise<string | undefined> {
  const manifest = input.manifest ?? (await fetchLlamaCppBackendManifest());
  const manifestEntry = findManifestEntry(manifest, input.ref);
  if (manifestEntry) {
    return validateBackendForMachine(manifestEntry, input.platform, input.arch, input.hasNvidiaGpu);
  }

  const buildInfo = readBackendBuildInfo(getLlamaCppBackendDir(input.runtimeRoot, input.ref));
  if (!buildInfo) return undefined;

  return validateBackendForMachine(
    {
      version: input.ref.version,
      backend: input.ref.backend,
      platform: normalizePlatform(String(buildInfo.platform ?? input.platform)),
      arch: normalizeArch(String(buildInfo.arch ?? input.arch)),
      accelerator:
        (buildInfo.accelerator as LlamaCppBackendManifestEntry['accelerator'] | undefined) ??
        inferBackendAccelerator(input.ref.backend),
      cudaMajor: buildInfo.cudaMajor as LlamaCppBackendManifestEntry['cudaMajor'] | undefined,
      archive: { assetName: '' },
    },
    input.platform,
    input.arch,
    input.hasNvidiaGpu,
  );
}

export function recommendLlamaCppBackend(input: {
  manifest: LlamaCppBackendManifest;
  platform: NodeJS.Platform;
  arch: string;
  hasNvidiaGpu: boolean;
  config?: LlamaCppServiceConfig;
  driverVersion?: string;
}): LlamaCppBackendRef | undefined {
  const normalizedPlatform = normalizePlatform(input.platform);
  const normalizedArch = normalizeArch(input.arch);
  const version =
    input.config?.runtimeVersion?.trim() ||
    input.manifest.defaultVersion ||
    latestManifestVersion(input.manifest);
  const compatible = input.manifest.backends.filter(
    entry =>
      normalizePlatform(entry.platform) === normalizedPlatform &&
      normalizeArch(entry.arch) === normalizedArch &&
      (!version || entry.version === version),
  );
  const desiredBackend = input.config?.runtimeBackend ?? LlamaCppRuntimeBackend.Auto;
  const preferredCudaMajor = resolvePreferredLlamaCppRuntimeCudaMajor({
    configured: input.config?.runtimeCudaMajor,
    driverVersion: input.driverVersion,
  });
  const selected = selectBackendByPriority(compatible, {
    platform: normalizedPlatform,
    arch: normalizedArch,
    hasNvidiaGpu: input.hasNvidiaGpu,
    desiredBackend,
    preferredCudaMajor,
  });
  return selected ? toBackendRef(selected.version, selected.backend) : undefined;
}

export function recommendLlamaCppCpuBackend(input: {
  manifest: LlamaCppBackendManifest;
  platform: NodeJS.Platform;
  arch: string;
  config?: LlamaCppServiceConfig;
}): LlamaCppBackendRef | undefined {
  return recommendLlamaCppBackend({
    ...input,
    hasNvidiaGpu: false,
    config: {
      ...input.config,
      runtimeBackend: LlamaCppRuntimeBackend.Cpu,
    },
  });
}

function selectBackendByPriority(
  compatible: LlamaCppBackendManifestEntry[],
  input: {
    platform: NodeJS.Platform;
    arch: string;
    hasNvidiaGpu: boolean;
    desiredBackend: LlamaCppRuntimeBackend;
    preferredCudaMajor: (typeof LlamaCppRuntimeCudaMajor)[keyof typeof LlamaCppRuntimeCudaMajor];
  },
): LlamaCppBackendManifestEntry | undefined {
  if ((input.platform === 'win32' || input.platform === 'linux') && input.arch === 'x64') {
    if (input.desiredBackend === LlamaCppRuntimeBackend.Cpu) {
      return compatible.find(entry => entry.accelerator === 'cpu');
    }
    if (input.desiredBackend === LlamaCppRuntimeBackend.Cuda) {
      return pickCudaBackendEntry(compatible, input.preferredCudaMajor);
    }
    if (input.hasNvidiaGpu) {
      return (
        pickCudaBackendEntry(compatible, input.preferredCudaMajor) ??
        compatible.find(entry => entry.accelerator === 'cpu')
      );
    }
    if (input.platform === 'win32') {
      return (
        compatible.find(entry => entry.accelerator === 'vulkan') ??
        compatible.find(entry => entry.accelerator === 'cpu')
      );
    }
    return (
      compatible.find(entry => entry.accelerator === 'cpu') ??
      compatible.find(entry => entry.accelerator === 'vulkan')
    );
  }
  if (input.platform === 'win32' && input.arch === 'arm64') {
    return (
      compatible.find(entry => entry.backend === LlamaCppRuntimeTargetId.WinArm64) ??
      compatible.find(entry => entry.accelerator === 'cpu') ??
      compatible[0]
    );
  }
  return (
    compatible.find(entry => entry.accelerator === 'metal') ??
    compatible.find(entry => entry.accelerator === 'cuda') ??
    compatible.find(entry => entry.accelerator === 'vulkan') ??
    compatible.find(entry => entry.accelerator === 'hip') ??
    compatible.find(entry => entry.accelerator === 'cpu') ??
    compatible[0]
  );
}

function pickCudaBackendEntry(
  compatible: LlamaCppBackendManifestEntry[],
  preferredCudaMajor: (typeof LlamaCppRuntimeCudaMajor)[keyof typeof LlamaCppRuntimeCudaMajor],
): LlamaCppBackendManifestEntry | undefined {
  const secondaryCudaMajor =
    preferredCudaMajor === LlamaCppRuntimeCudaMajor.Cuda13
      ? LlamaCppRuntimeCudaMajor.Cuda12
      : LlamaCppRuntimeCudaMajor.Cuda13;
  return (
    compatible.find(
      entry => entry.accelerator === 'cuda' && entry.cudaMajor === preferredCudaMajor,
    ) ??
    compatible.find(
      entry => entry.accelerator === 'cuda' && entry.cudaMajor === secondaryCudaMajor,
    ) ??
    compatible.find(entry => entry.accelerator === 'cuda')
  );
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
