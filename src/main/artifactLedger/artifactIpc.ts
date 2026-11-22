/**
 * Artifact ledger IPC: publish upserts to every renderer window and answer
 * `artifact:list` reads from the ledger. Registration also installs the
 * window fan-out as the recorder-side publisher sink.
 */
import { BrowserWindow } from 'electron';

import { CodingAgentProfileId } from '../../shared/codingAgent';
import { ArtifactIpc } from '../../shared/ipc/channels';
import type { CoworkPersistedArtifact } from '../../shared/cowork/artifacts';
import { getArtifactLedger, getStore } from '../appBootstrap/runtimeServices';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { artifactsContract } from '../../shared/ipc/artifactsContract';
import { artifactKeyForPath } from './artifactLedger';
import { isCodingLaneArtifact } from './codingLaneArtifacts';
import { setArtifactUpsertPublisher, type ArtifactUpsertEvent } from './publisher';

const MAX_SCOPE_ID_LENGTH = 200;

interface ArtifactListResult {
  success: boolean;
  artifacts?: CoworkPersistedArtifact[];
  error?: string;
}

function publishUpsertToWindows(event: ArtifactUpsertEvent): void {
  const lane = isCodingLaneArtifact(event.artifact)
    ? (getStore()
        .getDatabase()
        .prepare('SELECT id FROM coding_agent_lanes WHERE local_session_id = ? AND profile_id = ?')
        .get(event.scopeId, CodingAgentProfileId.Builtin) as { id: string } | undefined)
    : undefined;
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    try {
      window.webContents.send(ArtifactIpc.Upsert, event);
      if (lane) window.webContents.send(ArtifactIpc.Upsert, { ...event, scopeId: lane.id });
    } catch (error) {
      console.warn('[ArtifactLedger] failed to publish artifact upsert:', error);
    }
  }
}

function listArtifacts(scopeId: string): CoworkPersistedArtifact[] {
  const ledger = getArtifactLedger();
  const artifacts = ledger.list(scopeId);
  const lane = getStore()
    .getDatabase()
    .prepare('SELECT local_session_id FROM coding_agent_lanes WHERE id = ? AND profile_id = ?')
    .get(scopeId, CodingAgentProfileId.Builtin) as { local_session_id: string } | undefined;
  if (!lane) return artifacts;

  // Keep historical lane-only artifacts visible and prefer Pi for shared paths.
  const byPath = new Map<string, CoworkPersistedArtifact>();
  for (const artifact of [
    ...artifacts,
    ...ledger.list(lane.local_session_id).filter(isCodingLaneArtifact),
  ]) {
    byPath.set(artifact.filePath ? artifactKeyForPath(artifact.filePath) : artifact.id, artifact);
  }
  return [...byPath.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export const registerArtifactIpc = (): void => {
  setArtifactUpsertPublisher(publishUpsertToWindows);

  handleIpcContract(artifactsContract, {
    list: async (_event, rawScopeId): Promise<ArtifactListResult> => {
      try {
        const scopeId = rawScopeId.trim();
        if (!scopeId || scopeId.length > MAX_SCOPE_ID_LENGTH) {
          return { success: false, error: 'Invalid artifact scope id.' };
        }
        return { success: true, artifacts: listArtifacts(scopeId) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list artifacts',
        };
      }
    },
  });
};
