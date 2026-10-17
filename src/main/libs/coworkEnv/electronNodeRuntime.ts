import { app } from 'electron';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

import { coworkLog } from '../coworkLogger';

let cachedElectronNodeRuntimePath: string | null = null;

function resolveElectronNodeRuntimePath(): string {
  if (!app.isPackaged || process.platform !== 'darwin') {
    return process.execPath;
  }

  try {
    const appName = app.getName();
    const frameworksDir = join(process.resourcesPath, '..', 'Frameworks');
    if (!existsSync(frameworksDir)) {
      return process.execPath;
    }

    const helperApps = readdirSync(frameworksDir)
      .filter(entry => entry.startsWith(`${appName} Helper`) && entry.endsWith('.app'))
      .sort((a, b) => {
        const score = (name: string): number => {
          if (name === `${appName} Helper.app`) return 0;
          if (name === `${appName} Helper (Renderer).app`) return 1;
          if (name === `${appName} Helper (Plugin).app`) return 2;
          if (name === `${appName} Helper (GPU).app`) return 3;
          return 10;
        };
        return score(a) - score(b);
      });

    for (const helperApp of helperApps) {
      const helperExeName = helperApp.replace(/\.app$/, '');
      const helperExePath = join(frameworksDir, helperApp, 'Contents', 'MacOS', helperExeName);
      if (existsSync(helperExePath)) {
        coworkLog(
          'INFO',
          'resolveNodeShim',
          `Using Electron helper runtime for node shim: ${helperExePath}`,
        );
        return helperExePath;
      }
    }
  } catch (error) {
    coworkLog(
      'WARN',
      'resolveNodeShim',
      `Failed to resolve Electron helper runtime: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return process.execPath;
}

export function getElectronNodeRuntimePath(): string {
  if (!cachedElectronNodeRuntimePath) {
    cachedElectronNodeRuntimePath = resolveElectronNodeRuntimePath();
  }
  return cachedElectronNodeRuntimePath;
}
