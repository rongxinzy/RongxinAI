import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

import type {
  LlamaCppBackendArchivePart,
  LlamaCppBackendManifest,
  LlamaCppBackendManifestEntry,
} from '../../shared/llamacpp';

export const LLAMACPP_BACKEND_RESOURCES_DIR = 'llamacpp-backends';

export function resolveBundledLlamaCppBackendDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, LLAMACPP_BACKEND_RESOURCES_DIR);
  }
  return path.join(process.cwd(), 'build', 'win-full');
}

export function resolveBundledLlamaCppBackendManifestPath(): string {
  if (app.isPackaged) {
    return path.join(resolveBundledLlamaCppBackendDir(), 'manifest.json');
  }
  return path.join(process.cwd(), 'build', 'win-lite', 'manifest.json');
}

export function readBundledLlamaCppBackendManifest(): LlamaCppBackendManifest | undefined {
  if (process.platform !== 'win32') return undefined;

  const manifestPath = resolveBundledLlamaCppBackendManifestPath();
  if (!fs.existsSync(manifestPath)) return undefined;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LlamaCppBackendManifest;
  return {
    ...manifest,
    backends: manifest.backends.map(entry => injectBundledArchiveUrls(entry)),
  };
}

function injectBundledArchiveUrls(entry: LlamaCppBackendManifestEntry): LlamaCppBackendManifestEntry {
  return {
    ...entry,
    archive: entry.archive ? injectBundledArchiveUrl(entry.archive) : entry.archive,
    companions: entry.companions?.map(companion => injectBundledArchiveUrl(companion)),
  };
}

function injectBundledArchiveUrl<T extends { assetName: string; url?: string; parts?: LlamaCppBackendArchivePart[] }>(
  archive: T,
): T {
  return {
    ...archive,
    url: resolveBundledArchiveUrl(archive.assetName) ?? archive.url,
    parts: archive.parts?.map(part => ({
      ...part,
      url: resolveBundledArchiveUrl(part.assetName) ?? part.url,
    })),
  };
}

function resolveBundledArchiveUrl(assetName: string): string | undefined {
  const archivePath = path.join(resolveBundledLlamaCppBackendDir(), assetName);
  if (!fs.existsSync(archivePath)) return undefined;
  return pathToFileURL(archivePath).href;
}
