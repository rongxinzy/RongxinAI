/**
 * Artifact ledger IPC: publish upserts to every renderer window and answer
 * `artifact:list` reads from the ledger. Registration also installs the
 * window fan-out as the recorder-side publisher sink.
 */
import { BrowserWindow, ipcMain } from 'electron';

import { ArtifactIpc } from '../../shared/ipc/channels';
import type { CoworkPersistedArtifact } from '../../shared/cowork/artifacts';
import { getArtifactLedger } from '../appBootstrap/runtimeServices';
import { setArtifactUpsertPublisher, type ArtifactUpsertEvent } from './publisher';

const MAX_SCOPE_ID_LENGTH = 200;

interface ArtifactListResult {
  success: boolean;
  artifacts?: CoworkPersistedArtifact[];
  error?: string;
}

function publishUpsertToWindows(event: ArtifactUpsertEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    try {
      window.webContents.send(ArtifactIpc.Upsert, event);
    } catch (error) {
      console.warn('[ArtifactLedger] failed to publish artifact upsert:', error);
    }
  }
}

export const registerArtifactIpc = (): void => {
  setArtifactUpsertPublisher(publishUpsertToWindows);

  ipcMain.handle(
    ArtifactIpc.List,
    async (_event, rawScopeId: unknown): Promise<ArtifactListResult> => {
      try {
        const scopeId = typeof rawScopeId === 'string' ? rawScopeId.trim() : '';
        if (!scopeId || scopeId.length > MAX_SCOPE_ID_LENGTH) {
          return { success: false, error: 'Invalid artifact scope id.' };
        }
        return { success: true, artifacts: getArtifactLedger().list(scopeId) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list artifacts',
        };
      }
    },
  );
};
