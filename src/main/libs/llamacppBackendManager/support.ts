import crypto from 'crypto';
import extractZip from 'extract-zip';
import fs from 'fs';
import path from 'path';
import * as tar from 'tar';
import { fileURLToPath } from 'url';

import type {
  LlamaCppBackendArchivePart,
  LlamaCppBackendInfo,
  LlamaCppBackendManifest,
  LlamaCppBackendManifestEntry,
  LlamaCppBackendRef,
  LlamaCppInstallProgress,
  LlamaCppRuntimeInstallResult,
} from '../../../shared/llamacpp';
import { LlamaCppBackendError } from '../../../shared/llamacpp';
import { listLlamaCppRuntimeDevices } from '../llamacppRuntimeDeviceProbe';
import { LlamaCppRuntimeTargetId } from '../llamacppRuntimeConstants';
import { resolveLlamaCppExecutableName } from '../llamacppRuntimeInstaller';
import {
  DownloadCancelledError,
  downloadFileWithResume,
  throwIfDownloadCancelled,
} from '../resumableDownload';
import { DEFAULT_RELEASE_BASE_URL } from '../llamacppFallbackManifest';
import { getLlamaCppCurrentExecutablePath, toBackendRef } from './paths';

export const BUILD_INFO_FILE = 'runtime-build-info.json';
export const LLAMACPP_BACKEND_MANIFEST_FETCH_TIMEOUT_MS = 2_000;
let hasLoggedManifestFallback = false;

export function shouldLogManifestFallbackWarning(): boolean {
  return !hasLoggedManifestFallback;
}

export function setHasLoggedManifestFallback(): void {
  hasLoggedManifestFallback = true;
}
export const backendDownloadSizeCache = new Map<string, number>();

export type BackendInstallProgressReporter = (progress: LlamaCppInstallProgress) => void;

type LlamaCppBackendRootManifest = {
  schemaVersion: 1;
  defaultVersion?: string;
  versions?: string[];
  publicBaseUrl?: string;
};

export function resolveBundledManifestUrl(): string {
  return 'file://llamacpp-backends/manifest.json';
}

export async function fetchManifestFromUrl(manifestUrl: string): Promise<LlamaCppBackendManifest> {
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

export async function fetchVersionedManifestIndex(
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

export function injectVersionedArchiveUrls(
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

export function injectArchiveUrls<
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

export function normalizeManifest(
  manifest: LlamaCppBackendManifest,
  manifestUrl: string,
): LlamaCppBackendManifest {
  const releaseBaseUrl =
    manifest.releaseBaseUrl || manifestUrl.replace(/\/manifest\.json(?:[?#].*)?$/, '');
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

export function latestManifestVersion(manifest: LlamaCppBackendManifest): string | undefined {
  return manifest.backends.map(entry => entry.version).sort(compareVersionDesc)[0];
}

export function findManifestEntry(
  manifest: LlamaCppBackendManifest,
  ref: LlamaCppBackendRef,
): LlamaCppBackendManifestEntry | undefined {
  return manifest.backends.find(
    entry => entry.version === ref.version && normalizeBackendId(entry.backend) === ref.backend,
  );
}

export function validateBackendForMachine(
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
    return LlamaCppBackendError.CudaRequiresNvidiaGpu;
  }
  if (entry.accelerator === 'vulkan') {
    return 'Vulkan backend will validate device availability after installation.';
  }
  if (entry.backend === 'win-x64-hip') {
    return 'HIP backend requires a Windows x64 machine with AMD HIP/ROCm support. ZhiYuanAgent will validate device availability after installation.';
  }
  if (entry.backend === 'win-arm64-opencl-adreno') {
    if (normalizePlatform(platform) !== 'win32' || normalizeArch(arch) !== 'arm64') {
      return 'OpenCL Adreno backend only supports Windows ARM64 devices.';
    }
  }
  return undefined;
}

export function normalizePlatform(platform: string): NodeJS.Platform {
  if (platform === 'windows' || platform === 'win') return 'win32';
  if (platform === 'macos' || platform === 'mac') return 'darwin';
  return platform as NodeJS.Platform;
}

export function normalizeArch(arch: string): string {
  if (arch === 'amd64') return 'x64';
  if (arch === 'aarch64') return 'arm64';
  return arch;
}

export function normalizeBackendId(backend: string): string {
  if (/^win-cuda-13(?:\.\d+)?-x64$/i.test(backend)) return 'win-x64-cuda-13';
  if (/^win-cuda-12(?:\.\d+)?-x64$/i.test(backend)) return LlamaCppRuntimeTargetId.WinX64Cuda12;
  if (/^win-cuda-\d+(?:\.\d+)?-x64$/i.test(backend)) return LlamaCppRuntimeTargetId.WinX64Cuda12;
  if (backend === 'win-cpu-x64') return LlamaCppRuntimeTargetId.WinX64;
  if (backend === 'win-cpu-arm64') return LlamaCppRuntimeTargetId.WinArm64;
  if (backend === 'win-x64-vulkan') return 'win-x64-vulkan';
  if (backend === 'win-x64-hip') return 'win-x64-hip';
  if (backend === 'macos-arm64') return LlamaCppRuntimeTargetId.MacArm64;
  if (backend === 'macos-x64') return LlamaCppRuntimeTargetId.MacX64;
  if (backend === 'ubuntu-x64') return LlamaCppRuntimeTargetId.LinuxX64;
  if (backend === 'ubuntu-arm64') return LlamaCppRuntimeTargetId.LinuxArm64;
  return backend;
}

export function inferBackendAccelerator(
  backend: string,
): LlamaCppBackendManifestEntry['accelerator'] {
  if (backend.includes('cuda')) return 'cuda';
  if (backend.includes('vulkan')) return 'vulkan';
  if (backend.includes('hip') || backend.includes('rocm')) return 'hip';
  if (backend.includes('openvino')) return 'openvino';
  if (backend.includes('sycl')) return 'sycl';
  if (backend.startsWith('mac-') || backend.startsWith('macos-')) return 'metal';
  if (backend.includes('cpu') || backend.startsWith('win-') || backend.startsWith('linux-'))
    return 'cpu';
  return 'unknown';
}

export async function validateImportedBackendDevices(input: {
  runtimeRoot: string;
  ref: LlamaCppBackendRef;
  platform: NodeJS.Platform;
}): Promise<string | undefined> {
  const executablePath = getLlamaCppCurrentExecutablePath(input.runtimeRoot, input.platform);
  const devicesResult = await listLlamaCppRuntimeDevices({
    executablePath,
    platform: input.platform,
  });
  if (!devicesResult.success) {
    return `Failed to detect devices: ${devicesResult.error || 'unknown error'}`;
  }
  const detectedBackends = new Set(devicesResult.devices.map(device => device.backend));
  const requiredBackend = backendRequiresDeviceValidation(input.ref.backend);
  if (requiredBackend && !detectedBackends.has(requiredBackend)) {
    const detected = Array.from(detectedBackends).filter(Boolean).join(', ') || 'none';
    return `The selected backend requires ${requiredBackend}, but only ${detected} devices were detected.`;
  }
  return undefined;
}

export function backendRequiresDeviceValidation(backend: string): string | undefined {
  if (backend.includes('cuda')) return 'cuda';
  if (backend.includes('vulkan')) return 'vulkan';
  if (backend.includes('hip') || backend.includes('rocm')) return 'rocm';
  return undefined;
}

export async function downloadArchive(
  archive: {
    assetName: string;
    url?: string;
    sha256?: string;
    size?: number;
    parts?: LlamaCppBackendArchivePart[];
  },
  manifest: LlamaCppBackendManifest,
  downloadDir: string,
  onProgress?: BackendInstallProgressReporter,
  signal?: AbortSignal,
): Promise<string> {
  const outputPath = path.join(downloadDir, archive.assetName.replace(/\.part-[a-z]+$/i, ''));
  if (archive.parts && archive.parts.length > 0) {
    const partTotals = new Map<string, number>();
    const partCompleted = new Map<string, number>();
    const sumPartValues = (entries: Map<string, number>) =>
      [...entries.values()].reduce((sum, value) => sum + value, 0);
    const buffers: Buffer[] = [];
    for (const part of archive.parts) {
      const partPath = path.join(downloadDir, part.assetName);
      await downloadFile(
        resolvePartUrl(part, manifest),
        partPath,
        part.size,
        (completed, total, speed) => {
          if (typeof total === 'number' && total > 0) partTotals.set(part.assetName, total);
          partCompleted.set(part.assetName, completed);
          onProgress?.({
            phase: 'downloading-progress',
            completed: sumPartValues(partCompleted),
            total: partTotals.size > 0 ? sumPartValues(partTotals) : undefined,
            percent:
              partTotals.size > 0 && sumPartValues(partTotals) > 0
                ? Math.round((sumPartValues(partCompleted) / sumPartValues(partTotals)) * 100)
                : undefined,
            speed,
            targetPath: outputPath,
          });
        },
        signal,
      );
      if (part.sha256) verifySha256(partPath, part.sha256);
      buffers.push(fs.readFileSync(partPath));
    }
    fs.writeFileSync(outputPath, Buffer.concat(buffers));
  } else {
    await downloadFile(
      resolveArchiveUrl(archive, manifest),
      outputPath,
      archive.size,
      (completed, total, speed) => {
        onProgress?.({
          phase: 'downloading-progress',
          completed,
          total,
          percent:
            typeof total === 'number' && total > 0
              ? Math.round((completed / total) * 100)
              : undefined,
          speed,
          targetPath: outputPath,
        });
      },
      signal,
    );
  }
  if (archive.sha256) verifySha256(outputPath, archive.sha256);
  return outputPath;
}

export function resolveArchiveUrl(
  archive: { assetName: string; url?: string },
  manifest: LlamaCppBackendManifest,
): string {
  if (archive.url) return archive.url;
  return `${(manifest.releaseBaseUrl || DEFAULT_RELEASE_BASE_URL).replace(/\/$/, '')}/${archive.assetName}`;
}

export function resolvePartUrl(
  part: LlamaCppBackendArchivePart,
  manifest: LlamaCppBackendManifest,
): string {
  if (part.url) return part.url;
  return `${(manifest.releaseBaseUrl || DEFAULT_RELEASE_BASE_URL).replace(/\/$/, '')}/${part.assetName}`;
}

export async function downloadFile(
  url: string,
  outputPath: string,
  expectedSize?: number,
  onProgress?: (completed: number, total?: number, speed?: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (url.startsWith('file:')) {
    await copyLocalFileWithProgress(fileURLToPath(url), outputPath, onProgress, signal);
    return;
  }

  const urls = [url];
  const errors: string[] = [];
  for (const attemptUrl of urls) {
    try {
      await downloadFileWithResume({
        url: attemptUrl,
        outputPath,
        expectedSize,
        onProgress,
        signal,
      });
      return;
    } catch (error) {
      if (error instanceof DownloadCancelledError || signal?.aborted) throw error;
      errors.push(`${error instanceof Error ? error.message : String(error)} (${attemptUrl})`);
    }
  }
  throw new Error(`Download failed: ${errors.join('; ')}`);
}

export async function copyLocalFileWithProgress(
  sourcePath: string,
  outputPath: string,
  onProgress?: (completed: number, total?: number, speed?: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfDownloadCancelled(signal);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.download`;
  fs.rmSync(tempPath, { force: true });

  const total = fs.statSync(sourcePath).size;
  let completed = 0;
  let speedWindowBytes = 0;
  let speedWindowStartedAt = Date.now();
  const emitProgress = () => {
    const now = Date.now();
    const elapsedMs = Math.max(1, now - speedWindowStartedAt);
    const speed = speedWindowBytes > 0 ? (speedWindowBytes / elapsedMs) * 1000 : undefined;
    onProgress?.(completed, total, speed);
    if (speedWindowBytes > 0 || elapsedMs >= 1000) {
      speedWindowBytes = 0;
      speedWindowStartedAt = now;
    }
  };

  await new Promise<void>((resolve, reject) => {
    const reader = fs.createReadStream(sourcePath);
    const writer = fs.createWriteStream(tempPath);

    reader.on('data', chunk => {
      completed += chunk.length;
      speedWindowBytes += chunk.length;
      emitProgress();
    });
    reader.on('error', reject);
    writer.on('error', reject);
    writer.on('finish', resolve);
    reader.pipe(writer);
  });

  fs.renameSync(tempPath, outputPath);
  throwIfDownloadCancelled(signal);
  onProgress?.(completed, total, undefined);
}

export function verifySha256(filePath: string, expected: string): void {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    // A completed but corrupt cache entry cannot be resumed safely. Removing it
    // lets the next retry start clean instead of failing forever on the same file.
    fs.rmSync(filePath, { force: true });
    throw new Error(`SHA256 mismatch for ${path.basename(filePath)}.`);
  }
}

export async function extractArchive(archivePath: string, extractDir: string): Promise<void> {
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

export function isSupportedBackendArchivePath(sourcePath: string): boolean {
  return sourcePath.endsWith('.zip') || sourcePath.endsWith('.tar.gz');
}

export function resolveImportDirectoryFromSelectedFile(
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

export function findExecutablePath(rootDir: string, executableName: string): string | null {
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

export function findRuntimePayloadDirectory(rootDir: string): string {
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

export function writeBackendBuildInfo(runtimeDir: string, info: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(runtimeDir, BUILD_INFO_FILE),
    `${JSON.stringify(info, null, 2)}\n`,
    'utf8',
  );
}

export function parseBackendArchiveName(archiveName: string): {
  ref: LlamaCppBackendRef;
  platform: NodeJS.Platform;
  arch: string;
  companion: boolean;
} | null {
  const match =
    /^(.+?[-_])?llama(?:-main)?-(b\d+(?:-[a-f0-9]+)?)(?:-(cudart-llama))?-bin-(.+?)\.(?:tar\.gz|zip)$/i.exec(
      archiveName,
    );
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

export function findArchiveNameHint(sourceDir: string): string | undefined {
  const baseName = path.basename(sourceDir);
  if (/llama-(?:main-)?b\d+/i.test(baseName)) return baseName;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (
      /^(.+?[-_])?llama(?:-main)?-(b\d+(?:-[a-f0-9]+)?)(?:-(cudart-llama))?-bin-(.+?)\.(?:tar\.gz|zip)$/i.test(
        entry.name,
      )
    ) {
      return entry.name;
    }
  }
  return undefined;
}

export function inferBackendDirectoryMetadata(input: {
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
  const backend = inferDirectoryBackendId(
    input.sourceDir,
    path.dirname(input.executablePath),
    input.platform,
    input.arch,
  );
  if (!backend) return null;
  const accelerator = inferBackendAccelerator(backend);
  return {
    ref: toBackendRef(version, backend),
    platform: normalizePlatform(input.platform),
    arch: normalizeArch(input.arch),
    accelerator,
    cudaMajor: backend.includes('cuda-13') ? '13' : backend.includes('cuda-12') ? '12' : undefined,
  };
}

export function inferDirectoryVersion(
  sourceDir: string,
  executablePath: string,
): string | undefined {
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

export function inferDirectoryBackendId(
  sourceDir: string,
  executableDir: string,
  platform: NodeJS.Platform,
  arch: string,
): string | undefined {
  const normalizedPlatform = normalizePlatform(platform);
  const normalizedArch = normalizeArch(arch);
  if (normalizedPlatform === 'darwin') {
    return normalizedArch === 'arm64'
      ? LlamaCppRuntimeTargetId.MacArm64
      : LlamaCppRuntimeTargetId.MacX64;
  }
  if (normalizedPlatform === 'linux') {
    if (normalizedArch === 'arm64') return LlamaCppRuntimeTargetId.LinuxArm64;
    if (hasCuda13RuntimeMarkers(sourceDir) || hasCuda13RuntimeMarkers(executableDir)) {
      return LlamaCppRuntimeTargetId.LinuxX64Cuda13;
    }
    if (hasCuda12RuntimeMarkers(sourceDir) || hasCuda12RuntimeMarkers(executableDir)) {
      return LlamaCppRuntimeTargetId.LinuxX64Cuda12;
    }
    return LlamaCppRuntimeTargetId.LinuxX64;
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

export function hasAnyCudaRuntimeMarkers(rootDir: string): boolean {
  return hasMarker(rootDir, /(?:ggml-cuda|cudart64_|cublas64_|cublasLt64_|cuda_runtime)/i);
}

export function hasCuda12RuntimeMarkers(rootDir: string): boolean {
  return hasMarker(rootDir, /(?:cudart64_12|cublas64_12|cublasLt64_12|cuda-12\.4|win-cuda-12\.)/i);
}

export function hasCuda13RuntimeMarkers(rootDir: string): boolean {
  return hasMarker(
    rootDir,
    /(?:cudart64_13|cublas64_13|cublasLt64_13|cuda-13\.[13]|win-cuda-13\.)/i,
  );
}

export function hasVulkanRuntimeMarkers(rootDir: string): boolean {
  return hasMarker(rootDir, /(?:ggml-vulkan|vulkan-1\.dll|win-vulkan)/i);
}

export function hasHipRuntimeMarkers(rootDir: string): boolean {
  return hasMarker(rootDir, /(?:ggml-hip|hipblas|rocblas|amdhip64|win-hip)/i);
}

export function hasMarker(rootDir: string, pattern: RegExp): boolean {
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

export function failedInstall(error: string): LlamaCppRuntimeInstallResult {
  return {
    success: false,
    plan: { kind: 'needs-manual', message: error },
    error,
  };
}

export function compareBackendInfo(a: LlamaCppBackendInfo, b: LlamaCppBackendInfo): number {
  return compareVersionDesc(a.version, b.version) || a.backend.localeCompare(b.backend);
}

export function compareVersionDesc(a: string | undefined, b: string | undefined): number {
  const left = Number.parseInt(a?.replace(/^b/, '') || '0', 10);
  const right = Number.parseInt(b?.replace(/^b/, '') || '0', 10);
  return right - left;
}
