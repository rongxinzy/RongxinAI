import crypto from 'crypto';
import extractZip from 'extract-zip';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as tar from 'tar';
import { fileURLToPath } from 'url';

import type {
  LlamaCppBackendManifest,
  LlamaCppBackendManifestEntry,
  LlamaCppBackendRef,
  LlamaCppInstallProgress,
  LlamaCppRuntimeImportResult,
  LlamaCppRuntimeInstallResult,
  LlamaCppRuntimeUninstallResult,
  LlamaCppStatusSnapshot,
} from '../../../shared/llamacpp';
import { listLlamaCppRuntimeDevices } from '../llamacppManager';
import { copyDirectoryContents, resolveLlamaCppExecutableName } from '../llamacppRuntimeInstaller';
import {
  DownloadCancelledError,
  downloadFileWithResume,
  throwIfDownloadCancelled,
} from '../resumableDownload';
import { fetchLlamaCppBackendManifest } from './catalog';
import {
  getLlamaCppBackendDir,
  getLlamaCppBackendDownloadDir,
  getLlamaCppBackendExecutablePath,
  getLlamaCppCurrentBackendDir,
  getLlamaCppCurrentExecutablePath,
  getManagedBackendBinDir,
  readBackendBuildInfo,
  readCurrentBackendRef,
  removeCurrentBackendLink,
  resolveManagedBackendExecutablePath,
  sanitizePathSegment,
  syncCurrentBackend,
  writeBackendBuildInfo,
} from './paths';
import {
  backendRequiresDeviceValidation,
  downloadArchive,
  failedInstall,
  findArchiveNameHint,
  findExecutablePath,
  findRuntimePayloadDirectory,
  inferBackendDirectoryMetadata,
  parseBackendArchiveName,
  restorePreviousBackend,
  extractArchive,
  findManifestEntry,
  inferBackendAccelerator,
  isSupportedBackendArchivePath,
  normalizePlatform,
  resolveArchiveUrl,
  resolveImportDirectoryFromSelectedFile,
  validateBackendForMachine,
  validateImportedBackendDevices,
  verifySha256,
} from './support';

const GITHUB_RELEASE_BASE_URL = 'https://github.com/ggml-org/llama.cpp/releases/download';

type BackendInstallProgressReporter = (progress: LlamaCppInstallProgress) => void;

export async function installLlamaCppBackend(input: {
  runtimeRoot: string;
  ref: LlamaCppBackendRef;
  platform: NodeJS.Platform;
  arch: string;
  hasNvidiaGpu: boolean;
  manifest?: LlamaCppBackendManifest;
  switchCurrent?: boolean;
  signal?: AbortSignal;
  onProgress?: BackendInstallProgressReporter;
}): Promise<LlamaCppRuntimeInstallResult> {
  const manifest = input.manifest ?? (await fetchLlamaCppBackendManifest());
  if (input.signal?.aborted) {
    return { ...failedInstall('Download cancelled.'), cancelled: true };
  }
  const entry = findManifestEntry(manifest, input.ref);
  if (!entry) {
    return failedInstall(`llama.cpp backend is not available: ${input.ref.versionBackend}`);
  }
  const validation = validateBackendForMachine(
    entry,
    input.platform,
    input.arch,
    input.hasNvidiaGpu,
  );
  if (validation) return failedInstall(validation);

  const backendDir = getLlamaCppBackendDir(input.runtimeRoot, input.ref);
  const executablePath = getLlamaCppBackendExecutablePath(
    input.runtimeRoot,
    input.ref,
    input.platform,
  );
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

  fs.mkdirSync(input.runtimeRoot, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(input.runtimeRoot, '.installing-'));
  const downloadDir = getLlamaCppBackendDownloadDir(input.runtimeRoot, input.ref);
  fs.mkdirSync(downloadDir, { recursive: true });
  const reportProgress = (progress: LlamaCppInstallProgress) => {
    input.onProgress?.({
      modelId: input.ref.versionBackend,
      modelName: input.ref.versionBackend,
      ...progress,
    });
  };
  try {
    throwIfDownloadCancelled(input.signal);
    if (!entry.archive) throw new Error(`Backend ${input.ref.versionBackend} has no archive.`);
    reportProgress({ phase: 'downloading' });
    const archivePath = await downloadArchive(
      entry.archive,
      manifest,
      downloadDir,
      progress => {
        reportProgress(progress);
      },
      input.signal,
    );
    throwIfDownloadCancelled(input.signal);
    const extractDir = path.join(tempDir, 'extract-main');
    fs.mkdirSync(extractDir, { recursive: true });
    reportProgress({ phase: 'installing', message: 'extracting' });
    await extractArchive(archivePath, extractDir);
    throwIfDownloadCancelled(input.signal);

    const executableName = resolveLlamaCppExecutableName(input.platform);
    const extractedExecutable = findExecutablePath(extractDir, executableName);
    if (!extractedExecutable) {
      throw new Error(`Backend archive does not contain ${executableName}.`);
    }

    throwIfDownloadCancelled(input.signal);
    fs.rmSync(backendDir, { recursive: true, force: true });
    fs.mkdirSync(getManagedBackendBinDir(backendDir), { recursive: true });
    copyDirectoryContents(path.dirname(extractedExecutable), getManagedBackendBinDir(backendDir));
    throwIfDownloadCancelled(input.signal);

    for (const companion of entry.companions ?? []) {
      reportProgress({ phase: 'downloading' });
      const companionPath = await downloadArchive(
        companion,
        manifest,
        downloadDir,
        progress => {
          reportProgress(progress);
        },
        input.signal,
      );
      throwIfDownloadCancelled(input.signal);
      const companionExtractDir = path.join(
        tempDir,
        `extract-${sanitizePathSegment(companion.assetName)}`,
      );
      fs.mkdirSync(companionExtractDir, { recursive: true });
      reportProgress({ phase: 'installing', message: 'extracting' });
      await extractArchive(companionPath, companionExtractDir);
      throwIfDownloadCancelled(input.signal);
      copyDirectoryContents(
        findRuntimePayloadDirectory(companionExtractDir),
        getManagedBackendBinDir(backendDir),
      );
      throwIfDownloadCancelled(input.signal);
    }

    throwIfDownloadCancelled(input.signal);
    reportProgress({ phase: 'detecting', message: 'verifying' });
    const installedExecutablePath = getLlamaCppBackendExecutablePath(
      input.runtimeRoot,
      input.ref,
      input.platform,
    );
    if (!fs.existsSync(installedExecutablePath)) {
      throw new Error(`Installed backend is missing ${path.join('build', 'bin', executableName)}.`);
    }
    if (input.platform !== 'win32') fs.chmodSync(installedExecutablePath, 0o755);

    throwIfDownloadCancelled(input.signal);
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
    throwIfDownloadCancelled(input.signal);
    if (input.switchCurrent !== false) syncCurrentBackend(input.runtimeRoot, input.ref);
    // Retain partial archives for a failed or cancelled resumable download, but
    // do not keep completed archives after the backend is installed.
    fs.rmSync(downloadDir, { recursive: true, force: true });
    // The manager validates GPU devices after this function returns. Keep the
    // install in the verification phase until that validation succeeds.
    reportProgress({ phase: 'detecting', message: 'verifying' });

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
    if (error instanceof DownloadCancelledError || input.signal?.aborted) {
      reportProgress({ phase: 'cancelled' });
      return { ...failedInstall('Download cancelled.'), cancelled: true };
    }
    reportProgress({
      phase: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    return failedInstall(error instanceof Error ? error.message : String(error));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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
    if (ref)
      fs.rmSync(getLlamaCppBackendDownloadDir(input.runtimeRoot, ref), {
        recursive: true,
        force: true,
      });
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
  const validation = validateBackendForMachine(
    entry,
    input.platform,
    input.arch,
    input.hasNvidiaGpu,
  );
  if (validation) return { success: false, error: validation };

  const backendDir = getLlamaCppBackendDir(input.runtimeRoot, parsed.ref);
  const previousRef = readCurrentBackendRef(input.runtimeRoot);
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
    const executablePath = getLlamaCppBackendExecutablePath(
      input.runtimeRoot,
      parsed.ref,
      input.platform,
    );
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

    const deviceError = await validateImportedBackendDevices({
      runtimeRoot: input.runtimeRoot,
      ref: parsed.ref,
      platform: input.platform,
    });
    if (deviceError) {
      throw new Error(deviceError);
    }

    return {
      success: true,
      backend: parsed.ref,
      executablePath: getLlamaCppCurrentExecutablePath(input.runtimeRoot, input.platform),
    };
  } catch (error) {
    fs.rmSync(backendDir, { recursive: true, force: true });
    restorePreviousBackend(input.runtimeRoot, previousRef);
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
      error:
        '所选文件不是有效的 llama.cpp backend 压缩包。请选择官方 zip/tar.gz 主包，或进入已解压目录后选择其中任意文件。',
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
    return {
      success: false,
      error: 'CUDA companion 包不能单独导入，请选择 llama backend 主包或完整解压目录。',
    };
  }

  const executableName = resolveLlamaCppExecutableName(input.platform);
  const executablePath = findExecutablePath(input.sourceDir, executableName);
  if (!executablePath) {
    return {
      success: false,
      error: `所选目录中缺少 ${executableName}。请选择已解压的 llama.cpp backend 目录。`,
    };
  }

  const metadata = inferBackendDirectoryMetadata({
    sourceDir: input.sourceDir,
    executablePath,
    platform: input.platform,
    arch: input.arch,
  });
  if (!metadata) {
    return {
      success: false,
      error:
        '无法从目录识别 llama.cpp backend 版本和类型。请选择包含版本号的目录，或直接选择官方压缩包。',
    };
  }

  const entry: LlamaCppBackendManifestEntry = {
    ...metadata.ref,
    platform: metadata.platform,
    arch: metadata.arch,
    accelerator: metadata.accelerator,
    cudaMajor: metadata.cudaMajor,
    archive: { assetName: path.basename(input.sourceDir) },
  };
  const validation = validateBackendForMachine(
    entry,
    input.platform,
    input.arch,
    input.hasNvidiaGpu,
  );
  if (validation) return { success: false, error: validation };

  const backendDir = getLlamaCppBackendDir(input.runtimeRoot, metadata.ref);
  const previousRef = readCurrentBackendRef(input.runtimeRoot);
  try {
    fs.rmSync(backendDir, { recursive: true, force: true });
    fs.mkdirSync(getManagedBackendBinDir(backendDir), { recursive: true });
    copyDirectoryContents(path.dirname(executablePath), getManagedBackendBinDir(backendDir));
    const installedExecutablePath = getLlamaCppBackendExecutablePath(
      input.runtimeRoot,
      metadata.ref,
      input.platform,
    );
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

    const deviceError = await validateImportedBackendDevices({
      runtimeRoot: input.runtimeRoot,
      ref: metadata.ref,
      platform: input.platform,
    });
    if (deviceError) {
      throw new Error(deviceError);
    }

    return {
      success: true,
      backend: metadata.ref,
      executablePath: getLlamaCppCurrentExecutablePath(input.runtimeRoot, input.platform),
    };
  } catch (error) {
    fs.rmSync(backendDir, { recursive: true, force: true });
    restorePreviousBackend(input.runtimeRoot, previousRef);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
