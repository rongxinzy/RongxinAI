import { existsSync } from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

export interface PiRtkRuntimePaths {
  executablePath: string;
  teeDirectory: string;
}

export function resolvePiRtkRuntimePaths(): PiRtkRuntimePaths | null {
  const executableName = process.platform === 'win32' ? 'rtk.exe' : 'rtk';
  const executablePath = app.isPackaged
    ? path.join(process.resourcesPath, 'rtk-runtime', executableName)
    : path.join(app.getAppPath(), 'vendor', 'rtk-runtime', 'current', executableName);
  if (!existsSync(executablePath)) return null;
  return {
    executablePath,
    teeDirectory: path.join(app.getPath('userData'), 'cowork', 'rtk-tee'),
  };
}
