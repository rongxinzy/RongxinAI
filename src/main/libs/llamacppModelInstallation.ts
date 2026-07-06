import fs from 'fs';
import path from 'path';

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
  if (input.downloadUrl?.trim() || input.filePath?.trim()) {
    return input;
  }
  const model = await marketplaceService.resolveModel(input.modelId.trim()).catch((): null => null);
  const filePath = model?.filePath?.trim();
  if (!filePath || !isGgufPath(filePath)) {
    return input;
  }
  return {
    ...input,
    filePath,
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
    );
    installedThisAttempt.add(targetPath);

    if (request.mmprojFilePath?.trim()) {
      const mmprojFilePath = request.mmprojFilePath.trim();
      const mmprojUrl = buildModelScopeFileUrl(modelId, mmprojFilePath, request.revision);
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
  if (input.downloadUrl?.trim()) return null;

  const repoFiles = await fetchModelScopeRepoFiles(input.modelId.trim(), input.revision).catch(
    (): null => null,
  );
  if (repoFiles && repoFiles.length > 0) {
    const filePath = chooseModelScopeInstallFile(repoFiles);
    if (!filePath) {
      return null;
    }
    return {
      ...input,
      filePath,
      mmprojFilePath: input.mmprojFilePath?.trim()
        ? chooseModelScopeMmprojFile(repoFiles)
        : input.mmprojFilePath,
    };
  }

  const model = await marketplaceService.resolveModel(input.modelId.trim()).catch((): null => null);
  const filePath = model?.filePath?.trim();
  if (!filePath || !isGgufPath(filePath)) {
    return null;
  }

  return {
    ...input,
    filePath,
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
  return (previous.filePath?.trim() ?? '') === (next.filePath?.trim() ?? '')
    && (previous.mmprojFilePath?.trim() ?? '') === (next.mmprojFilePath?.trim() ?? '')
    && (previous.downloadUrl?.trim() ?? '') === (next.downloadUrl?.trim() ?? '');
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
    return { filePath, downloadUrl };
  }

  const explicitFilePath = input.filePath?.trim();
  if (explicitFilePath) {
    if (!isGgufPath(explicitFilePath)) {
      throw new Error('Only GGUF model files can be installed for llama.cpp.');
    }
    const modelId = input.modelId.trim();
    try {
      const files = await fetchModelScopeRepoFiles(modelId, input.revision);
      const matchedFile = resolveExplicitModelScopeInstallFile(files, explicitFilePath);
      if (matchedFile) {
        return { filePath: matchedFile };
      }
      const ggufFile = chooseModelScopeInstallFile(files);
      if (ggufFile) {
        return { filePath: ggufFile };
      }
    } catch {
      // Keep the explicit file path as the fallback when repo metadata is unavailable.
    }
    return { filePath: explicitFilePath };
  }

  const modelId = input.modelId.trim();
  const files = await fetchModelScopeRepoFiles(modelId, input.revision);
  const ggufFile = chooseModelScopeInstallFile(files);
  if (!ggufFile) {
    throw new Error(
      `No GGUF files were found in ModelScope model ${modelId}. Use a GGUF repository or specify owner/repo::file.gguf.`,
    );
  }
  return { filePath: ggufFile };
}

export function buildModelScopeFileUrl(
  modelId: string,
  filePath: string,
  revision = 'master',
): string {
  const [owner, repo] = modelId.split('/');
  if (!owner || !repo) throw new Error('ModelScope model ID must be in owner/repo format.');
  return `https://www.modelscope.cn/models/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/resolve/${encodeURIComponent(revision)}/${encodeURIComponent(filePath)}`;
}

export async function fetchModelScopeRepoFiles(
  modelId: string,
  revision = 'master',
): Promise<string[]> {
  const [owner, repo] = modelId.split('/');
  if (!owner || !repo) throw new Error('ModelScope model ID must be in owner/repo format.');
  const params = new URLSearchParams({
    Revision: revision,
    Recursive: 'true',
  });
  let response: Response;
  try {
    response = await fetch(
      `https://www.modelscope.cn/api/v1/models/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/repo/files?${params.toString()}`,
      {
        headers: { 'User-Agent': 'RongxinAI/modelscope-gguf-installer' },
      },
    );
  } catch {
    throw new Error(
      'Unable to connect to ModelScope. Please check your network connection or proxy settings.',
    );
  }
  if (!response.ok) {
    throw new Error(`Failed to read ModelScope model files: HTTP ${response.status}`);
  }
  const payload = await response.json();
  return extractModelScopeFilePaths(payload);
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
  const mmprojFiles = files.filter(file => /^mmproj/i.test(path.basename(file)) && isGgufPath(file));
  if (mmprojFiles.length === 0) return undefined;
  const preferred = mmprojFiles.find(file => /f16/i.test(path.basename(file)));
  return preferred ?? mmprojFiles.sort((a, b) => a.localeCompare(b))[0];
}

function resolveExplicitModelScopeInstallFile(
  files: string[],
  explicitFilePath: string,
): string | undefined {
  const normalizedExplicit = normalizeModelScopeFilePath(explicitFilePath);
  const exactMatch = files.find(file => normalizeModelScopeFilePath(file) === normalizedExplicit);
  if (exactMatch) return exactMatch;

  const explicitBaseName = path.basename(normalizedExplicit);
  return files.find(file => path.basename(normalizeModelScopeFilePath(file)) === explicitBaseName);
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

function normalizeModelScopeFilePath(value: string): string {
  return value.trim().replace(/\\/g, '/').toLowerCase();
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
      fs.renameSync(tempPath, targetPath);
    }
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { force: true });
    }
    throw error;
  }
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
