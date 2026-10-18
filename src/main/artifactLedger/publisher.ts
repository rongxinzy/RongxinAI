/**
 * Electron-free publish point for artifact upserts.
 *
 * Session-side recorders (Pi runtime, coding lanes) live in modules that must
 * stay importable from tests without Electron. The IPC layer registers the
 * actual window fan-out here at bootstrap; recorders call
 * `publishArtifactUpsert` without knowing about BrowserWindow.
 */
import type { CoworkPersistedArtifact } from '../../shared/cowork/artifacts';

export interface ArtifactUpsertEvent {
  scopeId: string;
  artifact: CoworkPersistedArtifact;
}

type ArtifactUpsertPublisher = (event: ArtifactUpsertEvent) => void;

let publisher: ArtifactUpsertPublisher | null = null;

/** Register the main-process publish sink (idempotent, last one wins). */
export function setArtifactUpsertPublisher(next: ArtifactUpsertPublisher): void {
  publisher = next;
}

/** Fire-and-forget artifact publish; never throws into the recording path. */
export function publishArtifactUpsert(scopeId: string, artifact: CoworkPersistedArtifact): void {
  try {
    publisher?.({ scopeId, artifact });
  } catch (error) {
    console.warn('[ArtifactLedger] artifact upsert publish failed:', error);
  }
}
