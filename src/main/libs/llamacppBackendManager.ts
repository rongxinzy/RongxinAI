import crypto from 'crypto';
import extractZip from 'extract-zip';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as tar from 'tar';

import type {
  LlamaCppBackendArchivePart,
  LlamaCppBackendInfo,
  LlamaCppBackendManifest,
  LlamaCppBackendManifestEntry,
  LlamaCppBackendRef,
  LlamaCppRuntimeImportResult,
  LlamaCppRuntimeInstallResult,
  LlamaCppRuntimeUninstallResult,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import { LlamaCppRuntimeBackend } from '../../shared/llamacpp';
import { LlamaCppRuntimeTargetId } from './llamacppRuntimeConstants';
import {
  copyDirectoryContents,
  resolveLlamaCppExecutableName,
} from './llamacppRuntimeInstaller';

const DEFAULT_RUNTIME_VERSION = 'b9518';
const DEFAULT_RELEASE_BASE_URL =
  'https://rongxinai.krli.org/llamacpp';
const GITHUB_RELEASE_BASE_URL = 'https://github.com/ggml-org/llama.cpp/releases/download';
const BUILD_INFO_FILE = 'runtime-build-info.json';
let hasLoggedManifestFallback = false;

type LlamaCppBackendRootManifest = {
  schemaVersion: 1;
  defaultVersion?: string;
  versions?: string[];
  publicBaseUrl?: string;
};

export type LlamaCppBackendSelectionInput = {
  platform: NodeJS.Platform;
  arch: string;
  hasNvidiaGpu: boolean;
  config?: LlamaCppServiceConfig;
};

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

export function getLlamaCppCurrentExecutablePath(runtimeRoot: string, platform: NodeJS.Platform): string {
  return resolveManagedBackendExecutablePath(getLlamaCppCurrentBackendDir(runtimeRoot), platform);
}

export async function fetchLlamaCppBackendManifest(
  env: NodeJS.ProcessEnv = process.env,
): Promise<LlamaCppBackendManifest> {
  const explicitUrl = env.LLAMACPP_BACKEND_MANIFEST_URL?.trim();
  const version = env.LLAMACPP_RUNTIME_VERSION?.trim() || DEFAULT_RUNTIME_VERSION;
  const manifestUrl = explicitUrl || `${DEFAULT_RELEASE_BASE_URL}/manifest.json`;
  try {
    const manifest = await fetchManifestFromUrl(manifestUrl);
    if (manifest.backends.length === 0) throw new Error('The backend manifest does not contain any backends.');
    return manifest;
  } catch (error) {
    if (!hasLoggedManifestFallback) {
      console.warn('[LlamaCppBackend] manifest fetch failed, using built-in fallback:', error);
      hasLoggedManifestFallback = true;
    } else {
      console.debug('[LlamaCppBackend] manifest fetch failed again, continuing with built-in fallback.');
    }
    return buildFallbackManifest(version);
  }
}

async function fetchManifestFromUrl(manifestUrl: string): Promise<LlamaCppBackendManifest> {
  const response = await fetch(manifestUrl, {
    headers: { 'User-Agent': 'RongxinAI/llamacpp-backend-manager' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const parsed = await response.json() as LlamaCppBackendManifest | LlamaCppBackendRootManifest;
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
  const baseUrl = (rootManifest.publicBaseUrl || manifestUrl.replace(/\/manifest\.json(?:[?#].*)?$/, '')).replace(/\/$/, '');
  const manifests = await Promise.all(versions.map(async (version) => {
    const versionManifestUrl = `${baseUrl}/${version}/manifest.json`;
    const versionManifest = await fetchManifestFromUrl(versionManifestUrl);
    return {
      version,
      manifest: versionManifest,
    };
  }));
  return {
    schemaVersion: 1,
    defaultVersion: rootManifest.defaultVersion || manifests[0]?.manifest.defaultVersion || versions[0],
    releaseBaseUrl: baseUrl,
    backends: manifests.flatMap(({ version, manifest }) =>
      manifest.backends.map(entry => injectVersionedArchiveUrls(entry, manifest, version, baseUrl))
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

function injectArchiveUrls<T extends { assetName: string; url?: string; parts?: LlamaCppBackendArchivePart[] }>(
  archive: T,
  releaseBaseUrl: string,
): T {
  return {
    ...archive,
    url: archive.url || `${releaseBaseUrl}/${archive.assetName}`,
    parts: archive.parts?.map(part => ({
      ...part,
      url: part.url || `${releaseBaseUrl}/${part.assetName}`,
    })),
  };
}

export function buildFallbackManifest(version = DEFAULT_RUNTIME_VERSION): LlamaCppBackendManifest {
  return {
    schemaVersion: 1,
    defaultVersion: version,
    releaseBaseUrl: `${DEFAULT_RELEASE_BASE_URL}/${version}`,
    backends: [
      createFallbackEntry(version, LlamaCppRuntimeTargetId.WinX64, 'win32', 'x64', 'cpu', `llama-${version}-bin-win-cpu-x64.tar.gz`),
      {
        ...createFallbackEntry(version, LlamaCppRuntimeTargetId.WinX64Cuda12, 'win32', 'x64', 'cuda', `llama-${version}-bin-win-cuda-12.4-x64.tar.gz`),
        cudaMajor: '12',
        companions: [
          {
            assetName: `cudart-llama-bin-win-cuda-12.4-x64.tar.gz`,
            url: `${DEFAULT_RELEASE_BASE_URL}/${version}/cudart-llama-bin-win-cuda-12.4-x64.tar.gz`,
          },
        ],
      },
      {
        ...createFallbackEntry(version, 'win-x64-cuda-13', 'win32', 'x64', 'cuda', `llama-${version}-bin-win-cuda-13.3-x64.tar.gz`),
        cudaMajor: '13',
        companions: [
          {
            assetName: `cudart-llama-bin-win-cuda-13.3-x64.tar.gz`,
            url: `${DEFAULT_RELEASE_BASE_URL}/${version}/cudart-llama-bin-win-cuda-13.3-x64.tar.gz`,
          },
        ],
      },
      createFallbackEntry(version, 'win-x64-vulkan', 'win32', 'x64', 'vulkan', `llama-${version}-bin-win-vulkan-x64.tar.gz`),
      createFallbackEntry(version, 'win-x64-hip', 'win32', 'x64', 'hip', `llama-${version}-bin-win-hip-radeon-x64.tar.gz`),
      createFallbackEntry(version, LlamaCppRuntimeTargetId.WinArm64, 'win32', 'arm64', 'cpu', `llama-${version}-bin-win-cpu-arm64.tar.gz`),
      createFallbackEntry(version, 'win-arm64-opencl-adreno', 'win32', 'arm64', 'cpu', `llama-${version}-bin-win-opencl-adreno-arm64.tar.gz`),
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

export async function listLlamaCppBackends(input: {
  runtimeRoot: string;
  platform: NodeJS.Platform;
  arch: string;
  hasNvidiaGpu: boolean;
  config?: LlamaCppServiceConfig;
  manifest?: LlamaCppBackendManifest;
}): Promise<{ backends: LlamaCppBackendInfo[]; selection?: LlamaCppBackendRef; recommended?: LlamaCppBackendRef }> {
  const manifest = input.manifest ?? await fetchLlamaCppBackendManifest();
  const installed = listInstalledBackendRefs(input.runtimeRoot);
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
    };
  });
  const remoteKeys = new Set(remoteInfos.map(info => info.versionBackend));
  const localInfos = installed
    .filter(ref => !remoteKeys.has(ref.versionBackend))
    .map(ref => {
      const buildInfo = readBackendBuildInfo(getLlamaCppBackendDir(input.runtimeRoot, ref));
      return {
        ...ref,
        platform: String(buildInfo?.platform ?? input.platform),
        arch: String(buildInfo?.arch ?? input.arch),
        accelerator: inferBackendAccelerator(ref.backend),
        cudaMajor: ref.backend.includes('cuda-12') ? '12' as const : undefined,
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

export async function getLlamaCppBackendCompatibilityError(input: {
  runtimeRoot: string;
  ref: LlamaCppBackendRef;
  platform: NodeJS.Platform;
  arch: string;
  hasNvidiaGpu: boolean;
  manifest?: LlamaCppBackendManifest;
}): Promise<string | undefined> {
  const manifest = input.manifest ?? await fetchLlamaCppBackendManifest();
  const manifestEntry = findManifestEntry(manifest, input.ref);
  if (manifestEntry) {
    return validateBackendForMachine(manifestEntry, input.platform, input.arch, input.hasNvidiaGpu);
  }

  const buildInfo = readBackendBuildInfo(getLlamaCppBackendDir(input.runtimeRoot, input.ref));
  if (!buildInfo) return undefined;

  return validateBackendForMachine({
    version: input.ref.version,
    backend: input.ref.backend,
    platform: normalizePlatform(String(buildInfo.platform ?? input.platform)),
    arch: normalizeArch(String(buildInfo.arch ?? input.arch)),
    accelerator: (buildInfo.accelerator as LlamaCppBackendManifestEntry['accelerator'] | undefined) ?? inferBackendAccelerator(input.ref.backend),
    cudaMajor: buildInfo.cudaMajor as LlamaCppBackendManifestEntry['cudaMajor'] | undefined,
    archive: { assetName: '' },
  }, input.platform, input.arch, input.hasNvidiaGpu);
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
  const version = input.config?.runtimeVersion?.trim() || input.manifest.defaultVersion || latestManifestVersion(input.manifest);
  const compatible = input.manifest.backends.filter(entry =>
    normalizePlatform(entry.platform) === normalizedPlatform &&
    normalizeArch(entry.arch) === normalizedArch &&
    (!version || entry.version === version)
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
      return compatible.find(entry => entry.accelerator === 'cuda' && entry.cudaMajor === '13')
        ?? compatible.find(entry => entry.accelerator === 'cuda' && entry.cudaMajor === '12');
    }
    if (input.hasNvidiaGpu) {
      return compatible.find(entry => entry.accelerator === 'cuda' && entry.cudaMajor === '13')
        ?? compatible.find(entry => entry.accelerator === 'cuda' && entry.cudaMajor === '12')
        ?? compatible.find(entry => entry.accelerator === 'vulkan')
        ?? compatible.find(entry => entry.accelerator === 'hip')
        ?? compatible.find(entry => entry.accelerator === 'cpu');
    }
    return compatible.find(entry => entry.accelerator === 'vulkan')
      ?? compatible.find(entry => entry.accelerator === 'hip')
      ?? compatible.find(entry => entry.accelerator === 'cpu');
  }
  return compatible.find(entry => entry.accelerator === 'metal')
    ?? compatible.find(entry => entry.accelerator === 'cuda')
    ?? compatible.find(entry => entry.accelerator === 'vulkan')
    ?? compatible.find(entry => entry.accelerator === 'hip')
    ?? compatible.find(entry => entry.accelerator === 'cpu')
    ?? compatible[0];
}

export async function installLlamaCppBackend(input: {
  runtimeRoot: string;
  ref: LlamaCppBackendRef;
  platform: NodeJS.Platform;
  arch: string;
  hasNvidiaGpu: boolean;
  manifest?: LlamaCppBackendManifest;
  switchCurrent?: boolean;
}): Promise<LlamaCppRuntimeInstallResult> {
  const manifest = input.manifest ?? await fetchLlamaCppBackendManifest();
  const entry = findManifestEntry(manifest, input.ref);
  if (!entry) {
    return failedInstall(`llama.cpp backend is not available: ${input.ref.versionBackend}`);
  }
  const validation = validateBackendForMachine(entry, input.platform, input.arch, input.hasNvidiaGpu);
  if (validation) return failedInstall(validation);

  const backendDir = getLlamaCppBackendDir(input.runtimeRoot, input.ref);
  const executablePath = getLlamaCppBackendExecutablePath(input.runtimeRoot, input.ref, input.platform);
  if (fs.existsSync(executablePath)) {
    if (input.switchCurrent !== false) syncCurrentBackend(input.runtimeRoot, input.ref);
    return {
      success: true,
      backend: input.ref,
      executablePath: getLlamaCppCurrentExecutablePath(input.runtimeRoot, input.platform),
      plan: {
        kind: 'ready',
        executablePath: getLlamaCppCurrentExecutablePath(input.runtimeRoot, input.platform),
      },
    };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-backend-'));
  try {
    if (!entry.archive) throw new Error(`Backend ${input.ref.versionBackend} has no archive.`);
    const archivePath = await downloadArchive(entry.archive, manifest, tempDir);
    const extractDir = path.join(tempDir, 'extract-main');
    fs.mkdirSync(extractDir, { recursive: true });
    await extractArchive(archivePath, extractDir);

    const executableName = resolveLlamaCppExecutableName(input.platform);
    const extractedExecutable = findExecutablePath(extractDir, executableName);
    if (!extractedExecutable) {
      throw new Error(`Backend archive does not contain ${executableName}.`);
    }

    fs.rmSync(backendDir, { recursive: true, force: true });
    fs.mkdirSync(getManagedBackendBinDir(backendDir), { recursive: true });
    copyDirectoryContents(path.dirname(extractedExecutable), getManagedBackendBinDir(backendDir));

    for (const companion of entry.companions ?? []) {
      const companionPath = await downloadArchive(companion, manifest, tempDir);
      const companionExtractDir = path.join(tempDir, `extract-${sanitizePathSegment(companion.assetName)}`);
      fs.mkdirSync(companionExtractDir, { recursive: true });
      await extractArchive(companionPath, companionExtractDir);
      copyDirectoryContents(findRuntimePayloadDirectory(companionExtractDir), getManagedBackendBinDir(backendDir));
    }

    const installedExecutablePath = getLlamaCppBackendExecutablePath(input.runtimeRoot, input.ref, input.platform);
    if (!fs.existsSync(installedExecutablePath)) {
      throw new Error(`Installed backend is missing ${path.join('build', 'bin', executableName)}.`);
    }
    if (input.platform !== 'win32') fs.chmodSync(installedExecutablePath, 0o755);

    writeBackendBuildInfo(backendDir, {
      ...input.ref,
      target: input.ref.backend,
      source: 'gitee-manifest',
      platform: normalizePlatform(entry.platform),
      arch: entry.arch,
      accelerator: entry.accelerator,
      cudaMajor: entry.cudaMajor,
      installedAt: new Date().toISOString(),
    });
    if (input.switchCurrent !== false) syncCurrentBackend(input.runtimeRoot, input.ref);

    return {
      success: true,
      backend: input.ref,
      executablePath: getLlamaCppCurrentExecutablePath(input.runtimeRoot, input.platform),
      plan: {
        kind: 'download',
        targetId: input.ref.backend,
        runtimeRoot: input.runtimeRoot,
        executablePath: getLlamaCppCurrentExecutablePath(input.runtimeRoot, input.platform),
        url: resolveArchiveUrl(entry.archive, manifest),
      },
    };
  } catch (error) {
    fs.rmSync(backendDir, { recursive: true, force: true });
    return failedInstall(error instanceof Error ? error.message : String(error));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function updateLlamaCppBackend(input: {
  runtimeRoot: string;
  platform: NodeJS.Platform;
  arch: string;
  hasNvidiaGpu: boolean;
  config?: LlamaCppServiceConfig;
  manifest?: LlamaCppBackendManifest;
}): Promise<LlamaCppRuntimeInstallResult> {
  const manifest = input.manifest ?? await fetchLlamaCppBackendManifest();
  const recommended = recommendLlamaCppBackend({ ...input, manifest });
  if (!recommended) return failedInstall('No compatible llama.cpp backend is available.');
  return await installLlamaCppBackend({ ...input, manifest, ref: recommended });
}

export function uninstallLlamaCppBackend(input: {
  runtimeRoot: string;
  ref?: LlamaCppBackendRef;
  status: LlamaCppStatusSnapshot;
  stopCurrent: () => Promise<void>;
}): Promise<LlamaCppRuntimeUninstallResult> {
  return (async () => {
    const ref = input.ref ?? readCurrentBackendRef(input.runtimeRoot);
    const targetDir = ref ? getLlamaCppBackendDir(input.runtimeRoot, ref) : input.runtimeRoot;
    const current = readCurrentBackendRef(input.runtimeRoot);
    if (ref && current?.versionBackend === ref.versionBackend) {
      await input.stopCurrent();
      removeCurrentBackendLink(input.runtimeRoot);
    }
    const deleted = fs.existsSync(targetDir);
    fs.rmSync(targetDir, { recursive: true, force: true });
    return {
      success: true,
      deleted,
      runtimeRoot: targetDir,
      backend: ref,
      status: input.status,
    };
  })();
}

export async function importLlamaCppBackendArchive(input: {
  runtimeRoot: string;
  archivePath: string;
  platform: NodeJS.Platform;
  arch: string;
  hasNvidiaGpu: boolean;
}): Promise<LlamaCppRuntimeImportResult> {
  const archiveName = path.basename(input.archivePath);
  if (/cudart-llama-bin/i.test(archiveName)) {
    return { success: false, error: 'CUDA companion 包不能单独导入，请选择 llama backend 主包。' };
  }
  const parsed = parseBackendArchiveName(archiveName);
  if (!parsed) {
    return { success: false, error: '无法从文件名识别 llama.cpp backend 版本和类型。' };
  }
  if (parsed.companion) {
    return { success: false, error: 'CUDA companion 包不能单独导入，请选择 llama backend 主包。' };
  }
  const entry: LlamaCppBackendManifestEntry = {
    ...parsed.ref,
    platform: parsed.platform,
    arch: parsed.arch,
    accelerator: inferBackendAccelerator(parsed.ref.backend),
    cudaMajor: parsed.ref.backend.includes('cuda-12') ? '12' : undefined,
    archive: { assetName: path.basename(input.archivePath) },
  };
  const validation = validateBackendForMachine(entry, input.platform, input.arch, input.hasNvidiaGpu);
  if (validation) return { success: false, error: validation };

  const backendDir = getLlamaCppBackendDir(input.runtimeRoot, parsed.ref);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-backend-import-'));
  try {
    const extractDir = path.join(tempDir, 'extract');
    fs.mkdirSync(extractDir, { recursive: true });
    await extractArchive(input.archivePath, extractDir);
    const executableName = resolveLlamaCppExecutableName(input.platform);
    const extractedExecutable = findExecutablePath(extractDir, executableName);
    if (!extractedExecutable) {
      throw new Error(`导入包中缺少 ${executableName}。`);
    }
    fs.rmSync(backendDir, { recursive: true, force: true });
    fs.mkdirSync(getManagedBackendBinDir(backendDir), { recursive: true });
    copyDirectoryContents(path.dirname(extractedExecutable), getManagedBackendBinDir(backendDir));
    const executablePath = getLlamaCppBackendExecutablePath(input.runtimeRoot, parsed.ref, input.platform);
    if (input.platform !== 'win32') fs.chmodSync(executablePath, 0o755);
    writeBackendBuildInfo(backendDir, {
      ...parsed.ref,
      target: parsed.ref.backend,
      source: 'user-import',
      importedFrom: input.archivePath,
      platform: normalizePlatform(entry.platform),
      arch: entry.arch,
      accelerator: entry.accelerator,
      cudaMajor: entry.cudaMajor,
      installedAt: new Date().toISOString(),
    });
    syncCurrentBackend(input.runtimeRoot, parsed.ref);
    return {
      success: true,
      backend: parsed.ref,
      executablePath: getLlamaCppCurrentExecutablePath(input.runtimeRoot, input.platform),
    };
  } catch (error) {
    fs.rmSync(backendDir, { recursive: true, force: true });
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function importLlamaCppBackendPath(input: {
  runtimeRoot: string;
  sourcePath: string;
  platform: NodeJS.Platform;
  arch: string;
  hasNvidiaGpu: boolean;
}): Promise<LlamaCppRuntimeImportResult> {
  const stat = fs.statSync(input.sourcePath);
  if (stat.isDirectory()) {
    return await importLlamaCppBackendDirectory({
      runtimeRoot: input.runtimeRoot,
      sourceDir: input.sourcePath,
      platform: input.platform,
      arch: input.arch,
      hasNvidiaGpu: input.hasNvidiaGpu,
    });
  }
  if (!isSupportedBackendArchivePath(input.sourcePath)) {
    const resolvedSourceDir = resolveImportDirectoryFromSelectedFile(
      input.sourcePath,
      input.platform,
      input.arch,
    );
    if (resolvedSourceDir) {
      return await importLlamaCppBackendDirectory({
        runtimeRoot: input.runtimeRoot,
        sourceDir: resolvedSourceDir,
        platform: input.platform,
        arch: input.arch,
        hasNvidiaGpu: input.hasNvidiaGpu,
      });
    }
    return {
      success: false,
      error: '所选文件不是有效的 llama.cpp backend 压缩包。请选择官方 zip/tar.gz 主包，或进入已解压目录后选择其中任意文件。',
    };
  }
  return await importLlamaCppBackendArchive({
    runtimeRoot: input.runtimeRoot,
    archivePath: input.sourcePath,
    platform: input.platform,
    arch: input.arch,
    hasNvidiaGpu: input.hasNvidiaGpu,
  });
}

async function importLlamaCppBackendDirectory(input: {
  runtimeRoot: string;
  sourceDir: string;
  platform: NodeJS.Platform;
  arch: string;
  hasNvidiaGpu: boolean;
}): Promise<LlamaCppRuntimeImportResult> {
  const archiveNameHint = findArchiveNameHint(input.sourceDir);
  if (archiveNameHint && /cudart-llama-bin/i.test(archiveNameHint)) {
    return { success: false, error: 'CUDA companion 包不能单独导入，请选择 llama backend 主包或完整解压目录。' };
  }

  const executableName = resolveLlamaCppExecutableName(input.platform);
  const executablePath = findExecutablePath(input.sourceDir, executableName);
  if (!executablePath) {
    return { success: false, error: `所选目录中缺少 ${executableName}。请选择已解压的 llama.cpp backend 目录。` };
  }

  const metadata = inferBackendDirectoryMetadata({
    sourceDir: input.sourceDir,
    executablePath,
    platform: input.platform,
    arch: input.arch,
  });
  if (!metadata) {
    return { success: false, error: '无法从目录识别 llama.cpp backend 版本和类型。请选择包含版本号的目录，或直接选择官方压缩包。' };
  }

  const entry: LlamaCppBackendManifestEntry = {
    ...metadata.ref,
    platform: metadata.platform,
    arch: metadata.arch,
    accelerator: metadata.accelerator,
    cudaMajor: metadata.cudaMajor,
    archive: { assetName: path.basename(input.sourceDir) },
  };
  const validation = validateBackendForMachine(entry, input.platform, input.arch, input.hasNvidiaGpu);
  if (validation) return { success: false, error: validation };

  const backendDir = getLlamaCppBackendDir(input.runtimeRoot, metadata.ref);
  try {
    fs.rmSync(backendDir, { recursive: true, force: true });
    fs.mkdirSync(getManagedBackendBinDir(backendDir), { recursive: true });
    copyDirectoryContents(path.dirname(executablePath), getManagedBackendBinDir(backendDir));
    const installedExecutablePath = getLlamaCppBackendExecutablePath(input.runtimeRoot, metadata.ref, input.platform);
    if (input.platform !== 'win32') fs.chmodSync(installedExecutablePath, 0o755);
    writeBackendBuildInfo(backendDir, {
      ...metadata.ref,
      target: metadata.ref.backend,
      source: 'user-import',
      importedFrom: input.sourceDir,
      platform: normalizePlatform(metadata.platform),
      arch: metadata.arch,
      accelerator: metadata.accelerator,
      cudaMajor: metadata.cudaMajor,
      installedAt: new Date().toISOString(),
    });
    syncCurrentBackend(input.runtimeRoot, metadata.ref);
    return {
      success: true,
      backend: metadata.ref,
      executablePath: getLlamaCppCurrentExecutablePath(input.runtimeRoot, input.platform),
    };
  } catch (error) {
    fs.rmSync(backendDir, { recursive: true, force: true });
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function readCurrentBackendRef(runtimeRoot: string): LlamaCppBackendRef | undefined {
  return readBackendBuildInfo(getLlamaCppCurrentBackendDir(runtimeRoot));
}

export function readBackendBuildInfo(runtimeDir: string): (LlamaCppBackendRef & Record<string, unknown>) | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(runtimeDir, BUILD_INFO_FILE), 'utf8')) as Record<string, unknown>;
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

export function listInstalledBackendRefs(runtimeRoot: string): LlamaCppBackendRef[] {
  const backendsRoot = getLlamaCppBackendsRoot(runtimeRoot);
  if (!fs.existsSync(backendsRoot)) return [];
  const refs: LlamaCppBackendRef[] = [];
  for (const versionEntry of fs.readdirSync(backendsRoot, { withFileTypes: true })) {
    if (!versionEntry.isDirectory()) continue;
    for (const backendEntry of fs.readdirSync(path.join(backendsRoot, versionEntry.name), { withFileTypes: true })) {
      if (!backendEntry.isDirectory()) continue;
      const ref = toBackendRef(versionEntry.name, backendEntry.name);
      const executablePath = resolveManagedBackendExecutablePath(
        path.join(backendsRoot, ref.version, ref.backend),
        process.platform,
      );
      if (fs.existsSync(executablePath)) {
        refs.push(ref);
      }
    }
  }
  return refs;
}

function normalizeManifest(manifest: LlamaCppBackendManifest, manifestUrl: string): LlamaCppBackendManifest {
  const releaseBaseUrl = manifest.releaseBaseUrl || manifestUrl.replace(/\/manifest\.json(?:[?#].*)?$/, '');
  return {
    ...manifest,
    schemaVersion: 1,
    defaultVersion: manifest.defaultVersion || latestManifestVersion(manifest),
    releaseBaseUrl,
    backends: (Array.isArray(manifest.backends) ? manifest.backends : []).map(entry => ({
      ...entry,
      platform: normalizePlatform(entry.platform),
      arch: normalizeArch(entry.arch),
      backend: normalizeBackendId(entry.backend),
    })),
  };
}

function latestManifestVersion(manifest: LlamaCppBackendManifest): string | undefined {
  return manifest.backends.map(entry => entry.version).sort(compareVersionDesc)[0];
}

function findManifestEntry(
  manifest: LlamaCppBackendManifest,
  ref: LlamaCppBackendRef,
): LlamaCppBackendManifestEntry | undefined {
  return manifest.backends.find(entry =>
    entry.version === ref.version && normalizeBackendId(entry.backend) === ref.backend
  );
}

function validateBackendForMachine(
  entry: LlamaCppBackendManifestEntry,
  platform: NodeJS.Platform,
  arch: string,
  hasNvidiaGpu: boolean,
): string | undefined {
  if (normalizePlatform(entry.platform) !== normalizePlatform(platform)) {
    return `Backend ${entry.backend} does not match current platform ${platform}.`;
  }
  if (normalizeArch(entry.arch) !== normalizeArch(arch)) {
    return `Backend ${entry.backend} does not match current architecture ${arch}.`;
  }
  if (entry.accelerator === 'cuda' && !hasNvidiaGpu) {
    return 'CUDA backend requires an NVIDIA GPU.';
  }
  return undefined;
}

function normalizePlatform(platform: string): NodeJS.Platform {
  if (platform === 'windows' || platform === 'win') return 'win32';
  if (platform === 'macos' || platform === 'mac') return 'darwin';
  return platform as NodeJS.Platform;
}

function normalizeArch(arch: string): string {
  if (arch === 'amd64') return 'x64';
  if (arch === 'aarch64') return 'arm64';
  return arch;
}

function normalizeBackendId(backend: string): string {
  if (/^win-cuda-12(?:\.\d+)?-x64$/.test(backend)) return LlamaCppRuntimeTargetId.WinX64Cuda12;
  if (backend === 'win-cpu-x64') return LlamaCppRuntimeTargetId.WinX64;
  if (backend === 'win-cpu-arm64') return LlamaCppRuntimeTargetId.WinArm64;
  if (backend === 'macos-arm64') return LlamaCppRuntimeTargetId.MacArm64;
  if (backend === 'macos-x64') return LlamaCppRuntimeTargetId.MacX64;
  if (backend === 'ubuntu-x64') return LlamaCppRuntimeTargetId.LinuxX64;
  if (backend === 'ubuntu-arm64') return LlamaCppRuntimeTargetId.LinuxArm64;
  return backend;
}

function inferBackendAccelerator(backend: string): LlamaCppBackendManifestEntry['accelerator'] {
  if (backend.includes('cuda')) return 'cuda';
  if (backend.includes('vulkan')) return 'vulkan';
  if (backend.includes('hip') || backend.includes('rocm')) return 'hip';
  if (backend.includes('openvino')) return 'openvino';
  if (backend.includes('sycl')) return 'sycl';
  if (backend.startsWith('mac-') || backend.startsWith('macos-')) return 'metal';
  if (backend.includes('cpu') || backend.startsWith('win-') || backend.startsWith('linux-')) return 'cpu';
  return 'unknown';
}

async function downloadArchive(
  archive: {
    assetName: string;
    url?: string;
    sha256?: string;
    parts?: LlamaCppBackendArchivePart[];
  },
  manifest: LlamaCppBackendManifest,
  tempDir: string,
): Promise<string> {
  const outputPath = path.join(tempDir, archive.assetName.replace(/\.part-[a-z]+$/i, ''));
  if (archive.parts && archive.parts.length > 0) {
    const buffers: Buffer[] = [];
    for (const part of archive.parts) {
      const partPath = path.join(tempDir, part.assetName);
      await downloadFile(resolvePartUrl(part, manifest), partPath);
      if (part.sha256) verifySha256(partPath, part.sha256);
      buffers.push(fs.readFileSync(partPath));
    }
    fs.writeFileSync(outputPath, Buffer.concat(buffers));
  } else {
    await downloadFile(resolveArchiveUrl(archive, manifest), outputPath);
  }
  if (archive.sha256) verifySha256(outputPath, archive.sha256);
  return outputPath;
}

function resolveArchiveUrl(
  archive: { assetName: string; url?: string },
  manifest: LlamaCppBackendManifest,
): string {
  if (archive.url) return archive.url;
  return `${(manifest.releaseBaseUrl || DEFAULT_RELEASE_BASE_URL).replace(/\/$/, '')}/${archive.assetName}`;
}

function resolvePartUrl(part: LlamaCppBackendArchivePart, manifest: LlamaCppBackendManifest): string {
  if (part.url) return part.url;
  return `${(manifest.releaseBaseUrl || DEFAULT_RELEASE_BASE_URL).replace(/\/$/, '')}/${part.assetName}`;
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  const urls = url.includes('gitee.com/')
    ? [url, url.replace(DEFAULT_RELEASE_BASE_URL, GITHUB_RELEASE_BASE_URL)]
    : [url];
  const errors: string[] = [];
  for (const attemptUrl of urls) {
    const response = await fetch(attemptUrl, {
      headers: { 'User-Agent': 'RongxinAI/llamacpp-backend-manager' },
    });
    if (!response.ok || !response.body) {
      errors.push(`HTTP ${response.status} ${response.statusText} (${attemptUrl})`);
      continue;
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
    return;
  }
  throw new Error(`Download failed: ${errors.join('; ')}`);
}

function verifySha256(filePath: string, expected: string): void {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`SHA256 mismatch for ${path.basename(filePath)}.`);
  }
}

async function extractArchive(archivePath: string, extractDir: string): Promise<void> {
  if (archivePath.endsWith('.zip')) {
    await extractZip(archivePath, { dir: extractDir });
    return;
  }
  if (archivePath.endsWith('.tar.gz')) {
    await tar.x({ file: archivePath, cwd: extractDir });
    return;
  }
  throw new Error(`Unsupported llama.cpp backend archive format: ${archivePath}`);
}

function isSupportedBackendArchivePath(sourcePath: string): boolean {
  return sourcePath.endsWith('.zip') || sourcePath.endsWith('.tar.gz');
}

function resolveImportDirectoryFromSelectedFile(
  selectedFilePath: string,
  platform: NodeJS.Platform,
  arch: string,
): string | undefined {
  const executableName = resolveLlamaCppExecutableName(platform);
  let currentDir = path.dirname(selectedFilePath);
  for (let depth = 0; depth < 4; depth += 1) {
    const executablePath = findExecutablePath(currentDir, executableName);
    if (executablePath) {
      const metadata = inferBackendDirectoryMetadata({
        sourceDir: currentDir,
        executablePath,
        platform,
        arch,
      });
      if (metadata) {
        return currentDir;
      }
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return undefined;
}

function findExecutablePath(rootDir: string, executableName: string): string | null {
  const queue = [rootDir];
  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) continue;
    const directExecutable = path.join(currentDir, executableName);
    if (fs.existsSync(directExecutable)) return directExecutable;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) queue.push(path.join(currentDir, entry.name));
    }
  }
  return null;
}

function findRuntimePayloadDirectory(rootDir: string): string {
  const queue = [rootDir];
  let fallback: string | null = null;
  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) continue;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    if (entries.some(entry => entry.isFile() && /\.(dll|so|dylib)$/i.test(entry.name))) {
      if (path.basename(currentDir).toLowerCase() === 'bin') return currentDir;
      fallback ??= currentDir;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) queue.push(path.join(currentDir, entry.name));
    }
  }
  return fallback ?? rootDir;
}

function writeBackendBuildInfo(runtimeDir: string, info: Record<string, unknown>): void {
  fs.writeFileSync(path.join(runtimeDir, BUILD_INFO_FILE), `${JSON.stringify(info, null, 2)}\n`, 'utf8');
}

function parseBackendArchiveName(archiveName: string): {
  ref: LlamaCppBackendRef;
  platform: NodeJS.Platform;
  arch: string;
  companion: boolean;
} | null {
  const match = /^(.+?[-_])?llama(?:-main)?-(b\d+(?:-[a-f0-9]+)?)(?:-(cudart-llama))?-bin-(.+?)\.(?:tar\.gz|zip)$/i.exec(archiveName);
  if (!match) return null;
  const version = match[2];
  const companion = Boolean(match[3]);
  const rawBackend = match[4];
  const platform = rawBackend.startsWith('win-')
    ? 'win32'
    : rawBackend.startsWith('macos-')
      ? 'darwin'
      : rawBackend.startsWith('ubuntu-') || rawBackend.startsWith('linux-')
        ? 'linux'
        : process.platform;
  const arch = rawBackend.endsWith('-arm64') ? 'arm64' : 'x64';
  return {
    ref: toBackendRef(version, normalizeBackendId(rawBackend)),
    platform,
    arch,
    companion,
  };
}

function findArchiveNameHint(sourceDir: string): string | undefined {
  const baseName = path.basename(sourceDir);
  if (/llama-(?:main-)?b\d+/i.test(baseName)) return baseName;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (/^(.+?[-_])?llama(?:-main)?-(b\d+(?:-[a-f0-9]+)?)(?:-(cudart-llama))?-bin-(.+?)\.(?:tar\.gz|zip)$/i.test(entry.name)) {
      return entry.name;
    }
  }
  return undefined;
}

function inferBackendDirectoryMetadata(input: {
  sourceDir: string;
  executablePath: string;
  platform: NodeJS.Platform;
  arch: string;
}): {
  ref: LlamaCppBackendRef;
  platform: NodeJS.Platform;
  arch: string;
  accelerator: LlamaCppBackendManifestEntry['accelerator'];
  cudaMajor?: '12' | '13';
} | null {
  const archiveNameHint = findArchiveNameHint(input.sourceDir);
  const parsedArchive = archiveNameHint ? parseBackendArchiveName(archiveNameHint) : null;
  if (parsedArchive && !parsedArchive.companion) {
    const accelerator = inferBackendAccelerator(parsedArchive.ref.backend);
    return {
      ref: parsedArchive.ref,
      platform: parsedArchive.platform,
      arch: parsedArchive.arch,
      accelerator,
      cudaMajor: parsedArchive.ref.backend.includes('cuda-13')
        ? '13'
        : parsedArchive.ref.backend.includes('cuda-12')
          ? '12'
          : undefined,
    };
  }

  const version = inferDirectoryVersion(input.sourceDir, input.executablePath);
  if (!version) return null;
  const backend = inferDirectoryBackendId(input.sourceDir, path.dirname(input.executablePath), input.platform, input.arch);
  if (!backend) return null;
  const accelerator = inferBackendAccelerator(backend);
  return {
    ref: toBackendRef(version, backend),
    platform: normalizePlatform(input.platform),
    arch: normalizeArch(input.arch),
    accelerator,
    cudaMajor: backend.includes('cuda-13')
      ? '13'
      : backend.includes('cuda-12')
        ? '12'
        : undefined,
  };
}

function inferDirectoryVersion(sourceDir: string, executablePath: string): string | undefined {
  const candidates = [
    path.basename(sourceDir),
    path.basename(path.dirname(executablePath)),
    path.basename(path.dirname(path.dirname(executablePath))),
  ];
  for (const candidate of candidates) {
    const match = /(?:^|[^a-z0-9])(b\d+(?:-[a-f0-9]+)?)(?:$|[^a-z0-9])/i.exec(candidate);
    if (match) return match[1];
  }
  return undefined;
}

function inferDirectoryBackendId(
  sourceDir: string,
  executableDir: string,
  platform: NodeJS.Platform,
  arch: string,
): string | undefined {
  const normalizedPlatform = normalizePlatform(platform);
  const normalizedArch = normalizeArch(arch);
  if (normalizedPlatform === 'darwin') {
    return normalizedArch === 'arm64' ? LlamaCppRuntimeTargetId.MacArm64 : LlamaCppRuntimeTargetId.MacX64;
  }
  if (normalizedPlatform === 'linux') {
    return normalizedArch === 'arm64' ? LlamaCppRuntimeTargetId.LinuxArm64 : LlamaCppRuntimeTargetId.LinuxX64;
  }
  if (normalizedPlatform !== 'win32') return undefined;
  if (normalizedArch === 'arm64') return LlamaCppRuntimeTargetId.WinArm64;
  if (hasCuda13RuntimeMarkers(sourceDir) || hasCuda13RuntimeMarkers(executableDir)) {
    return 'win-x64-cuda-13';
  }
  if (hasCuda12RuntimeMarkers(sourceDir) || hasCuda12RuntimeMarkers(executableDir)) {
    return LlamaCppRuntimeTargetId.WinX64Cuda12;
  }
  if (hasVulkanRuntimeMarkers(sourceDir) || hasVulkanRuntimeMarkers(executableDir)) {
    return 'win-x64-vulkan';
  }
  if (hasHipRuntimeMarkers(sourceDir) || hasHipRuntimeMarkers(executableDir)) {
    return 'win-x64-hip';
  }
  return hasAnyCudaRuntimeMarkers(sourceDir) || hasAnyCudaRuntimeMarkers(executableDir)
    ? LlamaCppRuntimeTargetId.WinX64Cuda12
    : LlamaCppRuntimeTargetId.WinX64;
}

function hasAnyCudaRuntimeMarkers(rootDir: string): boolean {
  return hasMarker(rootDir, /(?:ggml-cuda|cudart64_|cublas64_|cublasLt64_|cuda_runtime)/i);
}

function hasCuda12RuntimeMarkers(rootDir: string): boolean {
  return hasMarker(rootDir, /(?:cudart64_12|cublas64_12|cublasLt64_12|cuda-12\.4|win-cuda-12\.)/i);
}

function hasCuda13RuntimeMarkers(rootDir: string): boolean {
  return hasMarker(rootDir, /(?:cudart64_13|cublas64_13|cublasLt64_13|cuda-13\.[13]|win-cuda-13\.)/i);
}

function hasVulkanRuntimeMarkers(rootDir: string): boolean {
  return hasMarker(rootDir, /(?:ggml-vulkan|vulkan-1\.dll|win-vulkan)/i);
}

function hasHipRuntimeMarkers(rootDir: string): boolean {
  return hasMarker(rootDir, /(?:ggml-hip|hipblas|rocblas|amdhip64|win-hip)/i);
}

function hasMarker(rootDir: string, pattern: RegExp): boolean {
  const queue = [rootDir];
  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) continue;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const nextPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(nextPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (pattern.test(entry.name) || /(?:nvcuda|nvml)\.dll$/i.test(entry.name)) {
        return true;
      }
    }
  }
  return false;
}

function getManagedBackendBinDir(runtimeDir: string): string {
  return path.join(runtimeDir, 'build', 'bin');
}

function resolveManagedBackendExecutablePath(runtimeDir: string, platform: NodeJS.Platform): string {
  const executableName = resolveLlamaCppExecutableName(platform);
  const buildBinPath = path.join(runtimeDir, 'build', 'bin', executableName);
  if (fs.existsSync(buildBinPath)) return buildBinPath;
  const flatBinPath = path.join(runtimeDir, 'bin', executableName);
  if (fs.existsSync(flatBinPath)) return flatBinPath;
  const rootPath = path.join(runtimeDir, executableName);
  if (fs.existsSync(rootPath)) return rootPath;
  return buildBinPath;
}

function removeCurrentBackendLink(runtimeRoot: string): void {
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

function sanitizePathSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+$/, '_') || 'archive';
}

function failedInstall(error: string): LlamaCppRuntimeInstallResult {
  return {
    success: false,
    plan: { kind: 'needs-manual', message: error },
    error,
  };
}

function compareBackendInfo(a: LlamaCppBackendInfo, b: LlamaCppBackendInfo): number {
  return compareVersionDesc(a.version, b.version) || a.backend.localeCompare(b.backend);
}

function compareVersionDesc(a: string | undefined, b: string | undefined): number {
  const left = Number.parseInt(a?.replace(/^b/, '') || '0', 10);
  const right = Number.parseInt(b?.replace(/^b/, '') || '0', 10);
  return right - left;
}
