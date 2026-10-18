import type { CoworkPersistedArtifact } from '../../shared/cowork/artifacts';
import type { IpcContractApi } from '../../shared/ipc/contract';
import type { artifactsContract } from '../../shared/ipc/artifactsContract';
import { ArtifactIpc } from '../../shared/ipc/channels';
import { artifactsContractChannels } from '../../shared/ipc/artifactsContract.channels';
import { onPush } from './pushChannel';
import { createIpcInvokers } from './createIpcInvokers';

export interface ArtifactUpsertEvent {
  scopeId: string;
  artifact: CoworkPersistedArtifact;
}

// Artifact ledger: live event-time artifact upserts and scoped reads. Invoke
// methods come from the contract channel map; the onUpsert push subscription
// stays hand-wired.
export const artifactsApi = {
  artifacts: {
    onUpsert: (callback: (event: ArtifactUpsertEvent) => void) =>
      onPush<ArtifactUpsertEvent>(ArtifactIpc.Upsert, callback),
    ...createIpcInvokers(artifactsContractChannels),
  } as IpcContractApi<typeof artifactsContract> & {
    /** Live artifact upserts for any scope (session or coding lane). */
    onUpsert: (callback: (event: ArtifactUpsertEvent) => void) => () => void;
  },
};
