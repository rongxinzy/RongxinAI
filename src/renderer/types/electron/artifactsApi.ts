/**
 * Artifacts preload surface, split from `../electron.d.ts`.
 *
 * The list signature derives from the zod IPC contract
 * (`src/shared/ipc/artifactsContract.ts`); the onUpsert push subscription stays
 * hand-typed.
 */
import type { CoworkPersistedArtifact } from '../../../shared/cowork/artifacts';
import type { IpcContractApi } from '../../../shared/ipc/contract';
import type { artifactsContract } from '../../../shared/ipc/artifactsContract';

type ArtifactsContractApi = IpcContractApi<typeof artifactsContract>;

export interface ArtifactsApi extends ArtifactsContractApi {
  /** Live artifact upserts for any scope (session or coding lane). */
  onUpsert: (
    callback: (event: { scopeId: string; artifact: CoworkPersistedArtifact }) => void,
  ) => () => void;
}
