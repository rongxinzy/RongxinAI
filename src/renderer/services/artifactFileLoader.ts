import { isBinaryArtifactFile } from '../../shared/cowork/artifactPreview';
import type { Artifact } from '../types/artifact';

export type LoadedArtifactFile = {
  content: string;
  filePath: string;
};

const pendingLoads = new Map<string, Promise<LoadedArtifactFile | null>>();

function normalizeFilePath(rawPath: string): string {
  let filePath = rawPath;
  if (filePath.startsWith('file:///')) filePath = filePath.slice(7);
  else if (filePath.startsWith('file://')) filePath = filePath.slice(7);
  else if (filePath.startsWith('file:/')) filePath = filePath.slice(5);
  if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1);
  return filePath;
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
    const readFile = window.electron?.dialog?.readFileAsDataUrl;
    if (typeof readFile !== 'function') return null;

    const result = await readFile(filePath);
    if (!result?.success || !result.dataUrl) {
      throw new Error(result?.error || 'Failed to read artifact file');
    }

    const content = isBinaryArtifactFile(filePath)
      ? result.dataUrl
      : decodeTextDataUrl(result.dataUrl);
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
  pendingLoads.delete(normalizeFilePath(filePath));
}
