import fs from 'fs';
import os from 'os';
import path from 'path';

import type {
  LlamaCppBackendManifest,
  LlamaCppBackendManifestEntry,
  LlamaCppBackendRef,
  LlamaCppInstallProgress,
  LlamaCppRuntimeImportResult,
  LlamaCppRuntimeInstallResult,
  LlamaCppRuntimeUninstallResult,
} from '../../../shared/llamacpp';
import { allowEndUserLlamaCppRuntimeDownload } from '../inferenceEditionPolicy';
import { resolveLlamaCppExecutableName } from '../llamacppRuntimeConstants';
import { DownloadCancelledError, throwIfDownloadCancelled } from '../resumableDownload';
import {
  getLlamaCppBackendDir,
  getLlamaCppBackendExecutablePath,
  getLlamaCppBackendDownloadDir,
  getLlamaCppCurrentExecutablePath,
  getManagedBackendBinDir,
  removeCurrentBackendLink,
  sanitizePathSegment,
  toBackendRef,
} from './paths';
import {
  copyDirectoryContents,
  extractArchive,
  failedInstall,
  findExecutablePath,
  findRuntimePayloadDirectory,
  inferBackendAccelerator,
  inferBackendDirectoryMetadata,
  isSupportedBackendArchivePath,
  normalizePlatform,
  parseBackendArchiveName,
  resolveImportDirectoryFromSelectedFile,
  validateBackendForMachine,
  validateImportedBackendDevices,
  writeBackendBuildInfo,
  findArchiveNameHint,
  downloadArchive,
  findManifestEntry,
  resolveArchiveUrl,
} from './support';
import { fetchLlamaCppBackendManifest, readCurrentBackendRef, syncCurrentBackend } from './catalog';

export type BackendInstallProgressReporter = import('./support').BackendInstallProgressReporter;

function restorePreviousBackend(
  runtimeRoot: string,
  previousRef: LlamaCppBackendRef | undefined,
): void {
  if (!previousRef) {
    removeCurrentBackendLink(runtimeRoot);
    return;
  }
  try {
    syncCurrentBackend(runtimeRoot, previousRef);
  } catch (error) {
    console.error('[LlamaCpp] failed to restore previous backend after import:', error);
    removeCurrentBackendLink(runtimeRoot);
  }
}

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
  if (!allowEndUserLlamaCppRuntimeDownload()) {
    return failedInstall(
      'This edition ships a fixed llama.cpp runtime and does not support downloading or switching backends.',
    );
  }
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
  const stagedBackend = path.join(tempDir, 'backend');
  const stagedBin = getManagedBackendBinDir(stagedBackend);
  let published = false;
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
    await fs.promises.mkdir(stagedBin, { recursive: true });
    await copyDirectoryContents(path.dirname(extractedExecutable), stagedBin, input.signal);
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
      await copyDirectoryContents(
        findRuntimePayloadDirectory(companionExtractDir),
        stagedBin,
        input.signal,
      );
      throwIfDownloadCancelled(input.signal);
    }

    throwIfDownloadCancelled(input.signal);
    reportProgress({ phase: 'detecting', message: 'verifying' });
    const installedExecutablePath = path.join(stagedBin, executableName);
    if (!fs.existsSync(installedExecutablePath)) {
      throw new Error(`Installed backend is missing ${path.join('build', 'bin', executableName)}.`);
    }
    if (input.platform !== 'win32') fs.chmodSync(installedExecutablePath, 0o755);

    throwIfDownloadCancelled(input.signal);
    writeBackendBuildInfo(stagedBackend, {
      ...input.ref,
      target: input.ref.backend,
      source: 'gitee-manifest',
      platform: normalizePlatform(entry.platform),
      arch: entry.arch,
      accelerator: entry.accelerator,
      cudaMajor: entry.cudaMajor,
      installedAt: new Date().toISOString(),
    });
    await fs.promises.mkdir(path.dirname(backendDir), { recursive: true });
    throwIfDownloadCancelled(input.signal);
    await fs.promises.rm(backendDir, { recursive: true, force: true });
    await fs.promises.rename(stagedBackend, backendDir);
    published = true;
    throwIfDownloadCancelled(input.signal);
    if (input.switchCurrent !== false) syncCurrentBackend(input.runtimeRoot, input.ref);
    // Retain partial archives for a failed or cancelled resumable download, but
    // do not keep completed archives after the backend is installed.
    await fs.promises.rm(downloadDir, { recursive: true, force: true });
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
    if (published) await fs.promises.rm(backendDir, { recursive: true, force: true });
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
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

export async function uninstallLlamaCppBackend(input: {
  runtimeRoot: string;
  ref?: LlamaCppBackendRef;
}): Promise<Omit<LlamaCppRuntimeUninstallResult, 'status'>> {
  const ref = input.ref ?? readCurrentBackendRef(input.runtimeRoot);
  const targetDir = ref ? getLlamaCppBackendDir(input.runtimeRoot, ref) : input.runtimeRoot;
  const current = readCurrentBackendRef(input.runtimeRoot);
  if (ref && current?.versionBackend === ref.versionBackend) {
    removeCurrentBackendLink(input.runtimeRoot);
  }
  const deleted = fs.existsSync(targetDir);
  await fs.promises.rm(targetDir, { recursive: true, force: true });
  if (ref)
    await fs.promises.rm(getLlamaCppBackendDownloadDir(input.runtimeRoot, ref), {
      recursive: true,
      force: true,
    });
  return {
    success: true,
    deleted,
    runtimeRoot: targetDir,
    backend: ref,
  };
}

export async function importLlamaCppBackendArchive(input: {
  runtimeRoot: string;
  archivePath: string;
  platform: NodeJS.Platform;
  arch: string;
  hasNvidiaGpu: boolean;
  beforeReplace?: () => Promise<void>;
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
    return await installImportedBackend({
      runtimeRoot: input.runtimeRoot,
      entry,
      platform: input.platform,
      executable: extractedExecutable,
      importedFrom: input.archivePath,
      beforeReplace: input.beforeReplace,
    });
  } catch (error) {
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
  beforeReplace?: () => Promise<void>;
}): Promise<LlamaCppRuntimeImportResult> {
  const stat = fs.statSync(input.sourcePath);
  if (stat.isDirectory()) {
    return await importLlamaCppBackendDirectory({
      runtimeRoot: input.runtimeRoot,
      sourceDir: input.sourcePath,
      platform: input.platform,
      arch: input.arch,
      hasNvidiaGpu: input.hasNvidiaGpu,
      beforeReplace: input.beforeReplace,
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
        beforeReplace: input.beforeReplace,
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
    beforeReplace: input.beforeReplace,
  });
}

async function importLlamaCppBackendDirectory(input: {
  runtimeRoot: string;
  sourceDir: string;
  platform: NodeJS.Platform;
  arch: string;
  hasNvidiaGpu: boolean;
  beforeReplace?: () => Promise<void>;
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

  return await installImportedBackend({
    runtimeRoot: input.runtimeRoot,
    entry,
    platform: input.platform,
    executable: executablePath,
    importedFrom: input.sourceDir,
    beforeReplace: input.beforeReplace,
  });
}

async function installImportedBackend(input: {
  runtimeRoot: string;
  entry: LlamaCppBackendManifestEntry;
  platform: NodeJS.Platform;
  executable: string;
  importedFrom: string;
  beforeReplace?: () => Promise<void>;
}): Promise<LlamaCppRuntimeImportResult> {
  const { runtimeRoot, entry, platform } = input;
  const ref = toBackendRef(entry.version, entry.backend);
  const backendDir = getLlamaCppBackendDir(runtimeRoot, ref);
  await fs.promises.mkdir(runtimeRoot, { recursive: true });
  const stage = await fs.promises.mkdtemp(path.join(runtimeRoot, '.backend-import-'));
  const backup = path.join(stage, 'previous');
  let preserveBackup = false;
  try {
    const stagedBackend = getLlamaCppBackendDir(stage, ref);
    const stagedBin = getManagedBackendBinDir(stagedBackend);
    fs.mkdirSync(stagedBin, { recursive: true });
    await copyDirectoryContents(path.dirname(input.executable), stagedBin);
    const stagedExecutable = getLlamaCppBackendExecutablePath(stage, ref, platform);
    if (platform !== 'win32') fs.chmodSync(stagedExecutable, 0o755);
    writeBackendBuildInfo(stagedBackend, {
      version: entry.version,
      backend: entry.backend,
      target: entry.backend,
      source: 'user-import',
      importedFrom: input.importedFrom,
      platform: normalizePlatform(entry.platform),
      arch: entry.arch,
      accelerator: entry.accelerator,
      cudaMajor: entry.cudaMajor,
      installedAt: new Date().toISOString(),
    });
    const deviceError = await validateImportedBackendDevices({
      runtimeRoot: stage,
      ref,
      platform,
    });
    if (deviceError) throw new Error(deviceError);

    await input.beforeReplace?.();
    const previous = readCurrentBackendRef(runtimeRoot);
    await fs.promises.mkdir(path.dirname(backendDir), { recursive: true });
    if (fs.existsSync(backendDir)) await fs.promises.rename(backendDir, backup);
    try {
      await fs.promises.rename(stagedBackend, backendDir);
      syncCurrentBackend(runtimeRoot, ref);
    } catch (error) {
      try {
        await fs.promises.rm(backendDir, { recursive: true, force: true });
        if (fs.existsSync(backup)) await fs.promises.rename(backup, backendDir);
        restorePreviousBackend(runtimeRoot, previous);
      } catch (restoreError) {
        preserveBackup = fs.existsSync(backup);
        console.error('[LlamaCpp] could not restore the imported backend backup:', restoreError);
        throw new Error('Could not restore the previous backend.', { cause: restoreError });
      }
      throw error;
    }
    return {
      success: true,
      backend: ref,
      executablePath: getLlamaCppCurrentExecutablePath(runtimeRoot, platform),
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (!preserveBackup) {
      await fs.promises.rm(stage, { recursive: true, force: true }).catch(error => {
        console.warn(
          '[LlamaCpp] could not clean up the imported backend staging directory:',
          error,
        );
      });
    }
  }
}
