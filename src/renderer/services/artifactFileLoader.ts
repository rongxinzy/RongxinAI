import { isBinaryArtifactFile } from '../../shared/cowork/artifactPreview';
import type { Artifact } from '../types/artifact';

export type LoadedArtifactFile = {
  content: string;
  filePath: string;
};

const MAX_CACHE_ENTRIES = 8;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;

type CachedDataUrl = {
  dataUrl: string;
  size: number;
  lastUsed: number;
};

const pendingLoads = new Map<string, Promise<LoadedArtifactFile | null>>();
const pendingDataUrlLoads = new Map<string, Promise<string>>();
const dataUrlCache = new Map<string, CachedDataUrl>();
const pathGenerations = new Map<string, number>();
let cachedBytes = 0;
let usageCounter = 0;
let cacheEpoch = 0;

function normalizeFilePath(rawPath: string): string {
  let filePath = rawPath;
  if (filePath.startsWith('file:///')) filePath = filePath.slice(7);
  else if (filePath.startsWith('file://')) filePath = filePath.slice(7);
  else if (filePath.startsWith('file:/')) filePath = filePath.slice(5);
  if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1);
  return filePath.replace(/\\/g, '/');
}

function resolveFilePath(rawPath: string, cwd?: string | null): string {
  const filePath = normalizeFilePath(rawPath);
  if (filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath)) return filePath;
  return `${cwd ?? ''}/${filePath}`.replace(/\\/g, '/');
}

function decodeTextDataUrl(dataUrl: string): string {
  const base64 = dataUrl.split(',')[1] || '';
  const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function evictDataUrlCache(): void {
  while (dataUrlCache.size > MAX_CACHE_ENTRIES || cachedBytes > MAX_CACHE_BYTES) {
    const oldest = [...dataUrlCache.entries()].reduce<[string, CachedDataUrl] | null>(
      (candidate, entry) =>
        !candidate || entry[1].lastUsed < candidate[1].lastUsed ? entry : candidate,
      null,
    );
    if (!oldest) return;
    dataUrlCache.delete(oldest[0]);
    cachedBytes -= oldest[1].size;
  }
}

/** Loads a path-backed artifact as a data URL through the shared preview broker. */
export function loadArtifactDataUrl(rawPath: string, cwd?: string | null): Promise<string> {
  const filePath = resolveFilePath(rawPath, cwd);
  const cached = dataUrlCache.get(filePath);
  if (cached) {
    cached.lastUsed = ++usageCounter;
    return Promise.resolve(cached.dataUrl);
  }

  const pending = pendingDataUrlLoads.get(filePath);
  if (pending) return pending;
  const generation = pathGenerations.get(filePath) ?? 0;
  const epoch = cacheEpoch;

  const load = (async () => {
    const readFile = window.electron?.dialog?.readFileAsDataUrl;
    if (typeof readFile !== 'function') throw new Error('Artifact file reader unavailable');

    const result = await readFile(filePath);
    if (!result?.success || !result.dataUrl) {
      throw new Error(result?.error || 'Failed to read artifact file');
    }

    if (cacheEpoch === epoch && (pathGenerations.get(filePath) ?? 0) === generation) {
      const entry: CachedDataUrl = {
        dataUrl: result.dataUrl,
        size: result.dataUrl.length * 2,
        lastUsed: ++usageCounter,
      };
      const previous = dataUrlCache.get(filePath);
      if (previous) cachedBytes -= previous.size;
      dataUrlCache.set(filePath, entry);
      cachedBytes += entry.size;
      evictDataUrlCache();
    }
    return result.dataUrl;
  })();

  pendingDataUrlLoads.set(filePath, load);
  void load.then(
    () => {
      if (pendingDataUrlLoads.get(filePath) === load) pendingDataUrlLoads.delete(filePath);
    },
    () => {
      if (pendingDataUrlLoads.get(filePath) === load) pendingDataUrlLoads.delete(filePath);
    },
  );
  return load;
}

/** Loads a path-backed artifact only when its preview is opened. */
export function loadArtifactFile(
  artifact: Artifact,
  cwd?: string | null,
): Promise<LoadedArtifactFile | null> {
  if (artifact.content || !artifact.filePath) {
    return Promise.resolve(null);
  }

  const filePath = resolveFilePath(artifact.filePath, cwd);
  const cached = pendingLoads.get(filePath);
  if (cached) return cached;

  const load = (async (): Promise<LoadedArtifactFile | null> => {
    const dataUrl = await loadArtifactDataUrl(filePath);

    const content = isBinaryArtifactFile(filePath) ? dataUrl : decodeTextDataUrl(dataUrl);
    return { content, filePath };
  })();

  pendingLoads.set(filePath, load);
  void load.then(
    () => {
      if (pendingLoads.get(filePath) === load) pendingLoads.delete(filePath);
    },
    () => {
      if (pendingLoads.get(filePath) === load) pendingLoads.delete(filePath);
    },
  );
  return load;
}

export function invalidateArtifactFile(filePath: string): void {
  const normalizedPath = resolveFilePath(filePath);
  pathGenerations.set(normalizedPath, (pathGenerations.get(normalizedPath) ?? 0) + 1);
  pendingLoads.delete(normalizedPath);
  pendingDataUrlLoads.delete(normalizedPath);
  const cached = dataUrlCache.get(normalizedPath);
  if (cached) {
    cachedBytes -= cached.size;
    dataUrlCache.delete(normalizedPath);
  }
}

export function clearArtifactFileCache(): void {
  cacheEpoch += 1;
  pendingLoads.clear();
  pendingDataUrlLoads.clear();
  dataUrlCache.clear();
  pathGenerations.clear();
  cachedBytes = 0;
}
