import fs from 'fs';
import path from 'path';

import { app } from 'electron';

import { STRATA_DEFAULT_SERVE_PORT } from '../../../shared/strata/constants';

export interface StrataBundledManifest {
  schemaVersion: number;
  releaseTag: string;
  defaultPort: number;
  runtimeRoot: string;
  componentsRoot: string;
  pythonExecutable: string;
  engineQwenFolder: string;
  engineDsv41Folder: string;
  sha256: {
    python: string;
    strata: string;
    strataDsv41: string;
  };
  attribution: string;
}

export function resolveStrataBundledRoot(): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'strata-bundled')]
    : [path.join(app.getAppPath(), 'resources', 'strata-bundled')];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'manifest.json'))) return candidate;
  }
  return null;
}

export function readStrataBundledManifest(
  root = resolveStrataBundledRoot(),
): StrataBundledManifest | null {
  if (!root) return null;
  const manifestPath = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as StrataBundledManifest;
}

export function resolveStrataDefaultPort(manifest: StrataBundledManifest | null): number {
  const fromManifest = manifest?.defaultPort;
  if (typeof fromManifest === 'number' && fromManifest > 0 && fromManifest <= 65535) {
    return fromManifest;
  }
  return STRATA_DEFAULT_SERVE_PORT;
}
