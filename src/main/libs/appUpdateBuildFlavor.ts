/**
 * Build-flavor metadata read from the packaged `package.json`.
 *
 * The update target and the macOS auto-update opt-in are baked into the build,
 * so the coordinator asks this module instead of carrying the parsing itself.
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { InferenceEdition, normalizeInferenceEdition } from '../../shared/inferenceEdition';

type AppPackageJson = {
  zhiyuanUpdateVariant?: unknown;
  zhiyuanMacAutoUpdateEnabled?: unknown;
};

function readAppPackageJson(): AppPackageJson | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'),
    ) as AppPackageJson;
  } catch {
    return null;
  }
}

/** Match the edition and package format registered by the release feed. */
export function resolveBuildVariant(): string {
  if (process.platform === 'darwin') return InferenceEdition.Cpu;
  const variant = readAppPackageJson()?.zhiyuanUpdateVariant;
  const edition = normalizeInferenceEdition(typeof variant === 'string' ? variant : undefined);
  if (process.platform === 'linux') {
    if (edition !== InferenceEdition.Cuda) {
      throw new Error('Linux online updates require a packaged CUDA edition');
    }
    return `${process.env.APPIMAGE ? 'appimage' : 'deb'}-${edition}`;
  }
  return edition;
}

/**
 * A packaged macOS build must opt in only after CI has signed and notarized it.
 * Missing metadata therefore falls back to the manual DMG.
 */
export function isElectronUpdaterEnabled(platform: string): boolean {
  if (platform !== 'darwin' || !app.isPackaged) return true;
  return readAppPackageJson()?.zhiyuanMacAutoUpdateEnabled === true;
}
