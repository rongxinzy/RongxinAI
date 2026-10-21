/**
 * Build-flavor metadata read from the packaged `package.json`.
 *
 * The update target and the macOS auto-update opt-in are baked into the build,
 * so the coordinator asks this module instead of carrying the parsing itself.
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

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

/** `lite`, `cpu`, `cuda` or `full`; unknown builds fall back to `lite`. */
export function resolveBuildVariant(): string {
  if (process.platform === 'linux') return process.env.APPIMAGE ? 'appimage' : 'deb';
  if (process.platform !== 'win32') return 'default';
  const variant = readAppPackageJson()?.zhiyuanUpdateVariant;
  if (typeof variant !== 'string') return 'lite';
  const normalized = variant.trim().toLowerCase();
  if (normalized === 'full' || normalized === 'cpu' || normalized === 'cuda') return normalized;
  return 'lite';
}

/**
 * A packaged macOS build must opt in only after CI has signed and notarized it.
 * Missing metadata therefore falls back to the manual DMG.
 */
export function isElectronUpdaterEnabled(platform: string): boolean {
  if (platform !== 'darwin' || !app.isPackaged) return true;
  return readAppPackageJson()?.zhiyuanMacAutoUpdateEnabled === true;
}
