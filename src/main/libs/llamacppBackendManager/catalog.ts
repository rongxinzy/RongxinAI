import fs from 'fs';
import path from 'path';

import type {
  LlamaCppBackendArchivePart,
  LlamaCppBackendInfo,
  LlamaCppBackendManifest,
  LlamaCppBackendManifestEntry,
  LlamaCppBackendRef,
  LlamaCppServiceConfig,
} from '../../../shared/llamacpp';
import { LlamaCppBackendError, LlamaCppRuntimeBackend } from '../../../shared/llamacpp';
import { LlamaCppRuntimeTargetId } from '../llamacppRuntimeConstants';
import { readBundledLlamaCppBackendManifest } from '../llamacppBackendResources';
import {
  buildFallbackManifest,
  DEFAULT_RELEASE_BASE_URL,
  DEFAULT_RUNTIME_VERSION,
} from '../llamacppFallbackManifest';
import {
  buildVersionBackend,
  getLlamaCppBackendDir,
  getLlamaCppBackendExecutablePath,
  getLlamaCppBackendsRoot,
  getLlamaCppCurrentBackendDir,
  getLlamaCppCurrentExecutablePath,
  listInstalledBackendRefs,
  readBackendBuildInfo,
  readCurrentBackendRef,
  toBackendRef,
} from './paths';
import {
  compareBackendInfo,
  compareVersionDesc,
  findManifestEntry,
  inferBackendAccelerator,
  latestManifestVersion,
  normalizeArch,
  normalizeBackendId,
  normalizeManifest,
  normalizePlatform,
  resolveArchiveUrl,
  resolvePartUrl,
  validateBackendForMachine,
} from './support';

const LLAMACPP_BACKEND_MANIFEST_FETCH_TIMEOUT_MS = 2_000;
let hasLoggedManifestFallback = false;
const backendDownloadSizeCache = new Map<string, number>();

type LlamaCppBackendRootManifest = {
  schemaVersion: 1;
  defaultVersion?: string;
  versions?: string[];
  publicBaseUrl?: string;
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
    if (!hasLoggedManifestFallback) {
      console.warn('[LlamaCppBackend] manifest fetch failed, using built-in fallback:', error);
      hasLoggedManifestFallback = true;
    } else {
      console.debug(
        '[LlamaCppBackend] manifest fetch failed again, continuing with built-in fallback.',
      );
    }
    return buildFallbackManifest(version);
  }
}

function resolveBundledManifestUrl(): string {
  return 'file://llamacpp-backends/manifest.json';
}

async function fetchManifestFromUrl(manifestUrl: string): Promise<LlamaCppBackendManifest> {
  const response = await fetch(manifestUrl, {
    headers: { 'User-Agent': 'ZhiYuanAgent/llamacpp-backend-manager' },
    // Listing must fall back promptly when the optional remote manifest is unavailable.
    signal: AbortSignal.timeout(LLAMACPP_BACKEND_MANIFEST_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const parsed = (await response.json()) as LlamaCppBackendManifest | LlamaCppBackendRootManifest;
  if (Array.isArray((parsed as LlamaCppBackendManifest).backends)) {
    return normalizeManifest(parsed as LlamaCppBackendManifest, manifestUrl);
  }
  return await fetchVersionedManifestIndex(parsed as LlamaCppBackendRootManifest, manifestUrl);
}

async function fetchVersionedManifestIndex(
  rootManifest: LlamaCppBackendRootManifest,
  manifestUrl: string,
): Promise<LlamaCppBackendManifest> {
  const versions = Array.isArray(rootManifest.versions)
    ? rootManifest.versions.map(item => String(item).trim()).filter(Boolean)
    : [];
  if (versions.length === 0) {
    throw new Error('The root backend manifest does not contain any versions.');
  }
  const baseUrl = (
    rootManifest.publicBaseUrl || manifestUrl.replace(/\/manifest\.json(?:[?#].*)?$/, '')
  ).replace(/\/$/, '');
  const manifests = await Promise.all(
    versions.map(async version => {
      const versionManifestUrl = `${baseUrl}/${version}/manifest.json`;
      const versionManifest = await fetchManifestFromUrl(versionManifestUrl);
      return {
        version,
        manifest: versionManifest,
      };
    }),
  );
  return {
    schemaVersion: 1,
    defaultVersion:
      rootManifest.defaultVersion || manifests[0]?.manifest.defaultVersion || versions[0],
    releaseBaseUrl: baseUrl,
    backends: manifests.flatMap(({ version, manifest }) =>
      manifest.backends.map(entry => injectVersionedArchiveUrls(entry, manifest, version, baseUrl)),
    ),
  };
}

function injectVersionedArchiveUrls(
  entry: LlamaCppBackendManifestEntry,
  manifest: LlamaCppBackendManifest,
  version: string,
  baseUrl: string,
): LlamaCppBackendManifestEntry {
  const releaseBaseUrl = (manifest.releaseBaseUrl || `${baseUrl}/${version}`).replace(/\/$/, '');
  return {
    ...entry,
    archive: injectArchiveUrls(entry.archive, releaseBaseUrl),
    companions: entry.companions?.map(companion => injectArchiveUrls(companion, releaseBaseUrl)),
  };
}

function injectArchiveUrls<
  T extends { assetName: string; url?: string; parts?: LlamaCppBackendArchivePart[] },
>(archive: T, releaseBaseUrl: string): T {
  return {
    ...archive,
    url: archive.url || `${releaseBaseUrl}/${archive.assetName}`,
    parts: archive.parts?.map(part => ({
      ...part,
      url: part.url || `${releaseBaseUrl}/${part.assetName}`,
    })),
  };
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
  const selected = selectBackendByPriority(compatible, {
    platform: normalizedPlatform,
    arch: normalizedArch,
    hasNvidiaGpu: input.hasNvidiaGpu,
    desiredBackend,
  });
  return selected ? toBackendRef(selected.version, selected.backend) : undefined;
}

function selectBackendByPriority(
  compatible: LlamaCppBackendManifestEntry[],
  input: {
    platform: NodeJS.Platform;
    arch: string;
    hasNvidiaGpu: boolean;
    desiredBackend: LlamaCppRuntimeBackend;
  },
): LlamaCppBackendManifestEntry | undefined {
  if (input.platform === 'win32' && input.arch === 'x64') {
    if (input.desiredBackend === LlamaCppRuntimeBackend.Cpu) {
      return compatible.find(entry => entry.accelerator === 'cpu');
    }
    if (input.desiredBackend === LlamaCppRuntimeBackend.Cuda) {
      return (
        compatible.find(entry => entry.accelerator === 'cuda' && entry.cudaMajor === '13') ??
        compatible.find(entry => entry.accelerator === 'cuda' && entry.cudaMajor === '12')
      );
    }
    if (input.hasNvidiaGpu) {
      return (
        compatible.find(entry => entry.accelerator === 'cuda' && entry.cudaMajor === '13') ??
        compatible.find(entry => entry.accelerator === 'cuda' && entry.cudaMajor === '12') ??
        compatible.find(entry => entry.accelerator === 'vulkan') ??
        compatible.find(entry => entry.accelerator === 'cpu')
      );
    }
    return (
      compatible.find(entry => entry.accelerator === 'vulkan') ??
      compatible.find(entry => entry.accelerator === 'cpu')
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
