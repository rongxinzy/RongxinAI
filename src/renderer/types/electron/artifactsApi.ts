import type { CoworkPersistedArtifact } from '../../../shared/cowork/artifacts';

export interface ArtifactsApi {
  /** Live artifact upserts for any scope (session or coding lane). */
  onUpsert: (
    callback: (event: { scopeId: string; artifact: CoworkPersistedArtifact }) => void,
  ) => () => void;
  /** Read all ledger artifacts for one scope. */
  list: (scopeId: string) => Promise<{
    success: boolean;
    artifacts?: CoworkPersistedArtifact[];
    error?: string;
  }>;
}
