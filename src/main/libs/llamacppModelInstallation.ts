import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

import type {
  LlamaCppInstallModelInput,
  LlamaCppInstallProgress,
  LlamaCppModel,
} from '../../shared/llamacpp';
import { resolveInstalledModelName } from './llamacppModelCatalog';
import { MarketplaceService } from './marketplaceService';

type RequestOptions = { signal?: AbortSignal };

export async function prefillInstallInputFromMarketplace(
  input: LlamaCppInstallModelInput,
  marketplaceService: MarketplaceService,
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
    throw new Error('The cloud catalogue has not verified an installable GGUF file for this model.');
  }
  const mmprojFile = model.files?.find(file => file.path === model.mmprojFilePath);
  return {
    ...input,
    filePath: selectedFile.path,
    downloadUrl: selectedFile.downloadUrl,
    revision: selectedFile.revision ?? model.runtime?.revision ?? input.revision,
    sha256: selectedFile.sha256,
    fileSizeBytes: selectedFile.sizeBytes,
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
  refreshModelsAfterInstall: () => Promise<void>;
}): Promise<LlamaCppModel> {
  const { request, safeModelDir, modelsDir, onProgress, options = {} } = input;
  const modelId = request.modelId.trim();
  const resolved = await resolveModelScopeInstallRequest(request);
  const filePath = resolved.filePath;
  const url = resolved.downloadUrl || buildModelScopeFileUrl(modelId, filePath, request.revision);
  const targetPath = resolveModelScopeTargetPath(safeModelDir, filePath);
  const installedThisAttempt = new Set<string>();

  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
    const actualSize = fs.statSync(targetPath).size;
    const actualSha256 = await sha256File(targetPath);
    if (
      actualSha256.toLowerCase() === request.sha256?.trim().toLowerCase() &&
      (!request.fileSizeBytes || actualSize === request.fileSizeBytes) &&
      isValidGgufFile(targetPath)
    ) {
      onProgress?.({
        phase: 'done',
        modelId,
        modelName: request.displayName ?? modelId,
        percent: 100,
        targetPath,
      });
      await input.refreshModelsAfterInstall();
      return buildInstalledModelRecord(modelsDir, targetPath);
    }
    fs.rmSync(targetPath, { force: true });
  }

  onProgress?.({
    phase: 'downloading',
    modelId,
    modelName: request.displayName ?? modelId,
    targetPath,
  });

  try {
    await downloadFile(
      url,
      targetPath,
      (completed, total) => {
        onProgress?.({
          phase: 'downloading-progress',
          modelId,
          modelName: request.displayName ?? modelId,
          completed,
          total,
          percent: total ? Math.round((completed / total) * 100) : undefined,
          targetPath,
        });
      },
      options.signal,
      request.sha256,
      request.fileSizeBytes,
    );
    installedThisAttempt.add(targetPath);

    if (request.mmprojFilePath?.trim()) {
      const mmprojFilePath = request.mmprojFilePath.trim();
      if (!request.mmprojSha256?.trim()) {
        throw new Error('The cloud catalogue did not provide a SHA-256 checksum for the mmproj file.');
      }
      const mmprojUrl =
        request.mmprojDownloadUrl?.trim() ||
        buildModelScopeFileUrl(modelId, mmprojFilePath, request.revision);
      const mmprojTargetPath = resolveModelScopeTargetPath(safeModelDir, mmprojFilePath);
      onProgress?.({
        phase: 'downloading',
        modelId,
        modelName: request.displayName ?? modelId,
        targetPath: mmprojTargetPath,
      });
      await downloadFile(
        mmprojUrl,
        mmprojTargetPath,
        (completed, total) => {
          onProgress?.({
            phase: 'downloading-progress',
            modelId,
            modelName: request.displayName ?? modelId,
            completed,
            total,
            percent: total ? Math.round((completed / total) * 100) : undefined,
            targetPath: mmprojTargetPath,
          });
        },
        options.signal,
        request.mmprojSha256,
      );
      installedThisAttempt.add(mmprojTargetPath);
    }
  } catch (error) {
    cleanupInstallArtifacts(installedThisAttempt, modelsDir);
    removeEmptyParentDirs(safeModelDir, modelsDir);
    throw error;
  }

  onProgress?.({
    phase: 'done',
    modelId,
    modelName: request.displayName ?? modelId,
    percent: 100,
    targetPath,
  });
  await input.refreshModelsAfterInstall();
  return buildInstalledModelRecord(modelsDir, targetPath);
}

export async function refreshInstallInputFromMarketplace(
  input: LlamaCppInstallModelInput,
  marketplaceService: MarketplaceService,
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
  return (
    (previous.filePath?.trim() ?? '') === (next.filePath?.trim() ?? '') &&
    (previous.mmprojFilePath?.trim() ?? '') === (next.mmprojFilePath?.trim() ?? '') &&
    (previous.downloadUrl?.trim() ?? '') === (next.downloadUrl?.trim() ?? '') &&
    (previous.mmprojDownloadUrl?.trim() ?? '') === (next.mmprojDownloadUrl?.trim() ?? '') &&
    (previous.revision?.trim() ?? '') === (next.revision?.trim() ?? '') &&
    (previous.sha256?.trim().toLowerCase() ?? '') === (next.sha256?.trim().toLowerCase() ?? '') &&
    (previous.mmprojSha256?.trim().toLowerCase() ?? '') === (next.mmprojSha256?.trim().toLowerCase() ?? '')
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

export function buildModelScopeFileUrl(
  modelId: string,
  filePath: string,
  revision = 'master',
): string {
  const [owner, repo] = modelId.split('/');
  if (!owner || !repo) throw new Error('ModelScope model ID must be in owner/repo format.');
  const encodedPath = filePath
    .split(/[\\/]+/)
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return `https://www.modelscope.cn/models/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/resolve/${encodeURIComponent(revision)}/${encodedPath}`;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecordString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isGgufPath(value: string): boolean {
  const pathname = /^https?:\/\//i.test(value) ? new URL(value).pathname : value;
  return pathname.toLowerCase().endsWith('.gguf');
}

function removeEmptyParentDirs(startDir: string, stopDir: string): void {
  let currentDir = path.resolve(startDir);
  const resolvedStopDir = path.resolve(stopDir);

  while (currentDir.startsWith(resolvedStopDir + path.sep)) {
    if (!safeIsDirectoryEmpty(currentDir)) return;
    fs.rmdirSync(currentDir);
    currentDir = path.dirname(currentDir);
  }
}

function cleanupInstallArtifacts(paths: Iterable<string>, rootDir: string): void {
  const resolvedRootDir = path.resolve(rootDir);
  for (const candidate of paths) {
    const target = path.resolve(candidate);
    if (!target.startsWith(resolvedRootDir + path.sep) && target !== resolvedRootDir) continue;
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true, recursive: true });
    }
    removeEmptyParentDirs(path.dirname(target), resolvedRootDir);
  }
}

function safeIsDirectoryEmpty(target: string): boolean {
  try {
    return fs.readdirSync(target).length === 0;
  } catch {
    return false;
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
  const targetDir = path.join(modelDir, ...segments);
  fs.mkdirSync(targetDir, { recursive: true });
  return path.join(targetDir, normalizedFileName);
}

function buildInstalledModelRecord(modelsDir: string, targetPath: string): LlamaCppModel {
  const modelName = resolveInstalledModelName(modelsDir, targetPath);
  return {
    name: modelName,
    id: modelName,
    model: modelName,
    path: targetPath,
    size: fs.statSync(targetPath).size,
    source: 'modelscope',
    status: 'unloaded',
    details: { format: 'gguf' },
  };
}

async function downloadFile(
  url: string,
  targetPath: string,
  onProgress: (completed: number, total?: number) => void,
  signal?: AbortSignal,
  expectedSha256?: string,
  expectedSizeBytes?: number,
): Promise<void> {
  const tempPath = `${targetPath}.download`;
  let completedSuccessfully = false;
  try {
    const resumeFrom = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0;
    let response: Response;
    try {
      response = await fetch(url, {
        signal,
        ...(resumeFrom > 0 ? { headers: { Range: `bytes=${resumeFrom}-` } } : {}),
      });
    } catch {
      throw new Error(
        'Model download failed due to network error. Please check your network connection or proxy settings.',
      );
    }
    if (!response.ok || !response.body) {
      throw new Error(`Model download failed: HTTP ${response.status}`);
    }
    const resumed = resumeFrom > 0 && response.status === 206;
    const totalHeader = response.headers.get('content-length');
    const contentRangeTotal = parseContentRangeTotal(response.headers.get('content-range'));
    const total =
      contentRangeTotal ??
      (totalHeader ? Number(totalHeader) + (resumed ? resumeFrom : 0) : undefined);
    const file = fs.createWriteStream(tempPath, { flags: resumed ? 'a' : 'w' });
    const reader = response.body.getReader();
    const onAbort = () => {
      void reader.cancel();
    };
    signal?.addEventListener('abort', onAbort);
    let completed = resumed ? resumeFrom : 0;
    try {
      if (completed > 0) onProgress(completed, Number.isFinite(total) ? total : undefined);
      while (true) {
        if (signal?.aborted) throw new Error('Install cancelled');
        const { value, done } = await reader.read();
        if (signal?.aborted) throw new Error('Install cancelled');
        if (done) break;
        completed += value.byteLength;
        if (!file.write(Buffer.from(value))) {
          await new Promise<void>(resolve => file.once('drain', resolve));
        }
        onProgress(completed, Number.isFinite(total) ? total : undefined);
      }
      completedSuccessfully = true;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      void reader.cancel();
      await new Promise<void>(resolve => file.end(resolve));
    }
    if (completedSuccessfully) {
      const actualSize = fs.statSync(tempPath).size;
      if (
        expectedSizeBytes &&
        Number.isSafeInteger(expectedSizeBytes) &&
        actualSize !== expectedSizeBytes
      ) {
        throw new Error(
          `Model download failed: byte-size mismatch (expected ${expectedSizeBytes}, received ${actualSize}).`,
        );
      }
      if (expectedSha256) {
        const actualSha256 = await sha256File(tempPath);
        if (actualSha256.toLowerCase() !== expectedSha256.trim().toLowerCase()) {
          throw new Error('Model download failed: SHA-256 checksum mismatch. Please retry the download.');
        }
      }
      assertValidGgufFile(tempPath);
      fs.renameSync(tempPath, targetPath);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      /(?:SHA-256 checksum mismatch|byte-size mismatch|invalid GGUF)/.test(error.message) &&
      fs.existsSync(tempPath)
    ) {
      fs.rmSync(tempPath, { force: true });
    }
    throw error;
  }
}

function isValidGgufFile(filePath: string): boolean {
  try {
    assertValidGgufFile(filePath);
    return true;
  } catch {
    return false;
  }
}

function assertValidGgufFile(filePath: string): void {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(8);
    if (fs.readSync(fd, header, 0, header.length, 0) !== header.length) {
      throw new Error('Model download failed: invalid GGUF header.');
    }
    if (header.toString('ascii', 0, 4) !== 'GGUF') {
      throw new Error('Model download failed: invalid GGUF magic bytes.');
    }
    const version = header.readUInt32LE(4);
    if (version < 2 || version > 3) {
      throw new Error(`Model download failed: invalid GGUF version ${version}.`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+$/, '_') || 'model';
}

function parseContentRangeTotal(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = value.match(/\/(\d+)$/);
  if (!match) return undefined;
  const total = Number(match[1]);
  return Number.isFinite(total) ? total : undefined;
}
