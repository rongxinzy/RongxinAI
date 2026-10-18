import { ipcRenderer } from 'electron';

import type { CoworkPersistedArtifact } from '../../shared/cowork/artifacts';
import { ArtifactIpc } from '../../shared/ipc/channels';
import { onPush } from './pushChannel';

export interface ArtifactUpsertEvent {
  scopeId: string;
  artifact: CoworkPersistedArtifact;
}

export interface ArtifactListResult {
  success: boolean;
  artifacts?: CoworkPersistedArtifact[];
  error?: string;
}

// Artifact ledger: live event-time artifact upserts and scoped reads.
export const artifactsApi = {
  artifacts: {
    /** Live artifact upserts for any scope (session or coding lane). */
    onUpsert: (callback: (event: ArtifactUpsertEvent) => void) =>
      onPush<ArtifactUpsertEvent>(ArtifactIpc.Upsert, callback),
    /** Read all ledger artifacts for one scope. */
    list: (scopeId: string): Promise<ArtifactListResult> =>
      ipcRenderer.invoke(ArtifactIpc.List, scopeId),
  },
};
