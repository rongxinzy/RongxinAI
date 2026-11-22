import fs from 'fs';
import path from 'path';

import type {
  LlamaCppInstallExtraFile,
  LlamaCppInstallModelInput,
  LlamaCppInstallProgress,
  LlamaCppModel,
} from '../../shared/llamacpp';
import { resolveGgufModelDownloadUrls } from '../../shared/llamacpp/modelDownloadUrls';
import { resolveInstalledModelName } from './llamacppModelCatalog';
import type { MarketplaceService } from './marketplaceService';
import type { MarketplaceModelFile } from '../../shared/marketplace';
import { isRecord } from '../../shared/lib/isRecord';
import { downloadLocalModelFile } from './localModelDownload';
import { removeEmptyParentDirs } from './llamacppManager/fileUtils';

type RequestOptions = { signal?: AbortSignal };

export function shardGroupKey(filePath: string): string | null {
  const match = filePath.match(/^(.*?)-?\d{5}-of-\d{5}\.gguf$/i);
  return match ? match[1] : null;
}

/**
 * Collects the sibling parts of a split-GGUF variant. The primary file is
 * model.filePath; every other file sharing its shard-group key must be
 * downloaded too so llama.cpp can load the sharded model.
 */
export function collectSplitVariantFiles(
  files: MarketplaceModelFile[] | undefined,
  primaryPath: string,
): LlamaCppInstallExtraFile[] {
  if (!files?.length) return [];
  const primaryKey = shardGroupKey(primaryPath);
  if (!primaryKey) return [];
  return files
    .filter(file => file.path !== primaryPath && shardGroupKey(file.path) === primaryKey)
    .map(file => ({
      path: file.path,
      downloadUrl: file.downloadUrl,
      revision: file.revision,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
    }));
}

export async function prefillInstallInputFromMarketplace(
  input: LlamaCppInstallModelInput,
  marketplaceService: Pick<MarketplaceService, 'resolveModel'>,
): Promise<LlamaCppInstallModelInput> {
  if (input.downloadUrl?.trim() && input.sha256?.trim()) {
    return input;
  }
  const model = await marketplaceService.resolveModel(input.modelId.trim()).catch((): null => null);
  const selectedFile =
    model?.files?.find(file => file.path === input.filePath?.trim()) ??
    model?.files?.find(file => file.isRecommended);
  if (
    model?.metadataStatus !== 'verified' ||
    !selectedFile?.path ||
    !isGgufPath(selectedFile.path) ||
    !selectedFile.sha256 ||
    !selectedFile.downloadUrl
  ) {
    throw new Error(
      'The cloud catalogue has not verified an installable GGUF file for this model.',
    );
  }
  const mmprojFile = model.files?.find(file => file.path === model.mmprojFilePath);
  return {
    ...input,
    filePath: selectedFile.path,
    downloadUrl: selectedFile.downloadUrl,
    revision: selectedFile.revision ?? model.runtime?.revision ?? input.revision,
    sha256: selectedFile.sha256,
    fileSizeBytes: selectedFile.sizeBytes,
    extraFiles: collectSplitVariantFiles(model.files, selectedFile.path),
    ...(mmprojFile?.path && mmprojFile.sha256 && mmprojFile.downloadUrl
      ? {
          mmprojFilePath: mmprojFile.path,
          mmprojDownloadUrl: mmprojFile.downloadUrl,
          mmprojSha256: mmprojFile.sha256,
        }
      : {}),
  };
}

export async function installModelOnce(input: {
  request: LlamaCppInstallModelInput;
  safeModelDir: string;
  modelsDir: string;
  onProgress?: (progress: LlamaCppInstallProgress) => void;
  options?: RequestOptions;
}): Promise<LlamaCppModel> {
  const { request, safeModelDir, modelsDir, onProgress, options = {} } = input;
  const modelId = request.modelId.trim();
  const resolved = await resolveModelScopeInstallRequest(request);
  const targetPath = resolveModelScopeTargetPath(safeModelDir, resolved.filePath);
  const files: LlamaCppInstallExtraFile[] = [
    {
      path: resolved.filePath,
      downloadUrl: resolved.downloadUrl,
      sha256: request.sha256,
      sizeBytes: request.fileSizeBytes,
    },
    ...(request.extraFiles ?? []),
  ];
  for (const extra of request.extraFiles ?? []) {
    if (!extra.sha256?.trim()) {
      throw new Error(
        'The cloud catalogue did not provide a SHA-256 checksum for every split part of this model.',
      );
    }
  }
  if (request.mmprojFilePath?.trim()) {
    if (!request.mmprojSha256?.trim()) {
      throw new Error(
        'The cloud catalogue did not provide a SHA-256 checksum for the mmproj file.',
      );
    }
    files.push({
      path: request.mmprojFilePath.trim(),
      downloadUrl: request.mmprojDownloadUrl,
      sha256: request.mmprojSha256,
    });
  }

  const installedThisAttempt = new Set<string>();
  const modelName = request.displayName ?? modelId;
  try {
    for (const file of files) {
      const destination = resolveModelScopeTargetPath(safeModelDir, file.path);
      const urls = resolveGgufModelDownloadUrls({
        modelId,
        filePath: file.path,
        revision: file.revision ?? request.revision,
        downloadUrl: file.downloadUrl,
      });
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      onProgress?.({ phase: 'downloading', modelId, modelName, targetPath: destination });
      const downloaded = await downloadLocalModelFile(
        urls,
        destination,
        (completed, total, speed) => {
          onProgress?.({
            phase: 'downloading-progress',
            modelId,
            modelName,
            completed,
            total,
            speed,
            percent: total ? Math.round((completed / total) * 100) : undefined,
            targetPath: destination,
          });
        },
        options.signal,
        file.sha256,
        file.sizeBytes,
      );
      if (downloaded) installedThisAttempt.add(destination);
    }
  } catch (error) {
    await cleanupInstallArtifacts(installedThisAttempt, modelsDir);
    await removeEmptyParentDirs(safeModelDir, modelsDir);
    throw error;
  }

  onProgress?.({
    phase: 'done',
    modelId,
    modelName,
    percent: 100,
    targetPath,
  });
  return buildInstalledModelRecord(modelsDir, targetPath);
}

export async function refreshInstallInputFromMarketplace(
  input: LlamaCppInstallModelInput,
  marketplaceService: Pick<MarketplaceService, 'resolveModel'>,
): Promise<LlamaCppInstallModelInput | null> {
  const model = await marketplaceService.resolveModel(input.modelId.trim()).catch((): null => null);
  const selectedFile = model?.files?.find(file => file.isRecommended);
  if (
    model?.metadataStatus !== 'verified' ||
    !selectedFile?.path ||
    !isGgufPath(selectedFile.path) ||
    !selectedFile.sha256 ||
    !selectedFile.downloadUrl
  ) {
    return null;
  }
  const mmprojFile = model.files?.find(file => file.path === model.mmprojFilePath);
  return {
    ...input,
    filePath: selectedFile.path,
    downloadUrl: selectedFile.downloadUrl,
    revision: selectedFile.revision ?? model.runtime?.revision ?? input.revision,
    sha256: selectedFile.sha256,
    fileSizeBytes: selectedFile.sizeBytes,
    extraFiles: collectSplitVariantFiles(model.files, selectedFile.path),
    ...(mmprojFile?.path && mmprojFile.sha256 && mmprojFile.downloadUrl
      ? {
          mmprojFilePath: mmprojFile.path,
          mmprojDownloadUrl: mmprojFile.downloadUrl,
          mmprojSha256: mmprojFile.sha256,
        }
      : {}),
  };
}

export function resolveManagedModelInstallDir(modelsDir: string, modelId: string): string {
  return path.join(modelsDir, 'modelscope', ...modelId.split('/').map(sanitizePathSegment));
}

export function isModelDownloadNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Model download failed: HTTP 404');
}

export function isSameInstallRequest(
  previous: LlamaCppInstallModelInput,
  next: LlamaCppInstallModelInput,
): boolean {
  const extraPaths = (input: LlamaCppInstallModelInput): string =>
    (input.extraFiles ?? [])
      .map(file => file.path?.trim() ?? '')
      .sort()
      .join('|');
  return (
    (previous.filePath?.trim() ?? '') === (next.filePath?.trim() ?? '') &&
    (previous.mmprojFilePath?.trim() ?? '') === (next.mmprojFilePath?.trim() ?? '') &&
    (previous.downloadUrl?.trim() ?? '') === (next.downloadUrl?.trim() ?? '') &&
    (previous.mmprojDownloadUrl?.trim() ?? '') === (next.mmprojDownloadUrl?.trim() ?? '') &&
    (previous.revision?.trim() ?? '') === (next.revision?.trim() ?? '') &&
    (previous.sha256?.trim().toLowerCase() ?? '') === (next.sha256?.trim().toLowerCase() ?? '') &&
    (previous.mmprojSha256?.trim().toLowerCase() ?? '') ===
      (next.mmprojSha256?.trim().toLowerCase() ?? '') &&
    extraPaths(previous) === extraPaths(next)
  );
}

export async function resolveModelScopeInstallRequest(input: LlamaCppInstallModelInput): Promise<{
  filePath: string;
  downloadUrl?: string;
}> {
  const downloadUrl = input.downloadUrl?.trim();
  if (downloadUrl) {
    const filePath =
      input.filePath?.trim() ||
      new URL(downloadUrl).pathname.split('/').filter(Boolean).pop() ||
      'model.gguf';
    if (!isGgufPath(filePath)) {
      throw new Error('Only GGUF model files can be installed for llama.cpp.');
    }
    if (!input.sha256?.trim() || !/^[a-f0-9]{64}$/i.test(input.sha256.trim())) {
      throw new Error('A verified SHA-256 checksum is required before installing a GGUF model.');
    }
    return { filePath, downloadUrl };
  }
  throw new Error('Install metadata must come from the verified cloud GGUF catalogue.');
}

export { buildModelScopeFileUrl } from '../../shared/llamacpp/modelDownloadUrls';

export function extractModelScopeFilePaths(payload: unknown): string[] {
  const records = extractRecords(payload);
  const paths = records
    .map(
      record =>
        readRecordString(record.Path) ||
        readRecordString(record.path) ||
        readRecordString(record.FilePath) ||
        readRecordString(record.filePath) ||
        readRecordString(record.Name) ||
        readRecordString(record.name),
    )
    .filter((value): value is string => Boolean(value));
  return [...new Set(paths)];
}

export function chooseModelScopeInstallFile(files: string[]): string | undefined {
  const ggufFiles = files.filter(file => isGgufPath(file) && !/^mmproj/i.test(path.basename(file)));
  if (ggufFiles.length === 0) return undefined;
  const preferred = ['q4_k_m', 'q5_k_m', 'q4_0', 'q8_0'];
  for (const quantization of preferred) {
    const match = ggufFiles.find(file => path.basename(file).toLowerCase().includes(quantization));
    if (match) return match;
  }
  return ggufFiles.sort((a, b) => a.localeCompare(b))[0];
}

export function chooseModelScopeMmprojFile(files: string[]): string | undefined {
  const mmprojFiles = files.filter(
    file => /^mmproj/i.test(path.basename(file)) && isGgufPath(file),
  );
  if (mmprojFiles.length === 0) return undefined;
  const preferred = mmprojFiles.find(file => /f16/i.test(path.basename(file)));
  return preferred ?? mmprojFiles.sort((a, b) => a.localeCompare(b))[0];
}

function extractRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  const records: Record<string, unknown>[] = [];
  const stack: unknown[] = [payload];
  while (stack.length > 0) {
    const item = stack.pop();
    if (Array.isArray(item)) {
      if (item.every(isRecord)) records.push(...item);
      item.forEach(child => stack.push(child));
      continue;
    }
    if (!isRecord(item)) continue;
    Object.values(item).forEach(child => {
      if (Array.isArray(child) || isRecord(child)) stack.push(child);
    });
  }
  return records;
}

function readRecordString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isGgufPath(value: string): boolean {
  const pathname = /^https?:\/\//i.test(value) ? new URL(value).pathname : value;
  return pathname.toLowerCase().endsWith('.gguf');
}

async function cleanupInstallArtifacts(paths: Iterable<string>, rootDir: string): Promise<void> {
  const resolvedRootDir = path.resolve(rootDir);
  for (const candidate of paths) {
    const target = path.resolve(candidate);
    if (!target.startsWith(resolvedRootDir + path.sep)) continue;
    await fs.promises.rm(target, { force: true });
    await removeEmptyParentDirs(path.dirname(target), resolvedRootDir);
  }
}

function resolveModelScopeTargetPath(modelDir: string, filePath: string): string {
  const segments = filePath
    .split(/[\\/]+/)
    .map(sanitizePathSegment)
    .filter(Boolean);
  const fileName = segments.pop() || 'model.gguf';
  const normalizedFileName = fileName.toLowerCase().endsWith('.gguf')
    ? fileName
    : `${fileName}.gguf`;
  return path.join(modelDir, ...segments, normalizedFileName);
}

async function buildInstalledModelRecord(
  modelsDir: string,
  targetPath: string,
): Promise<LlamaCppModel> {
  const modelName = resolveInstalledModelName(modelsDir, targetPath);
  return {
    name: modelName,
    id: modelName,
    model: modelName,
    path: targetPath,
    size: (await fs.promises.stat(targetPath)).size,
    source: 'modelscope',
    status: 'unloaded',
    details: { format: 'gguf' },
  };
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+$/, '_') || 'model';
}
