import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ipcMain } from 'electron';

import { DialogIpc } from '../shared/ipc/channels';

/** Check metadata and read permission without loading or encoding the file. */
export async function checkArtifactFile(filePath: unknown): Promise<{ success: boolean }> {
  if (typeof filePath !== 'string') return { success: false };
  try {
    const resolvedPath = filePath.startsWith('file:') ? fileURLToPath(filePath) : filePath;
    if (!path.isAbsolute(resolvedPath) || !(await stat(resolvedPath)).isFile()) {
      return { success: false };
    }
    await access(resolvedPath, constants.R_OK);
    return { success: true };
  } catch {
    return { success: false };
  }
}

export function registerArtifactFileAvailabilityHandler(): void {
  ipcMain.handle(DialogIpc.CheckArtifactFile, (_event, filePath: unknown) =>
    checkArtifactFile(filePath),
  );
}
