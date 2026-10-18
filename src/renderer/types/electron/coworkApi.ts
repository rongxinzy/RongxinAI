/**
 * Cowork preload surface, split from `../electron.d.ts`.
 *
 * Method signatures and data types derive from the zod IPC contract
 * (`src/shared/ipc/coworkContract.ts`) — the contract is the single source of
 * truth shared with main and preload. Push subscriptions (onStream* /
 * onSessionsChanged) are not part of the contract and stay hand-typed.
 */

import type { IpcContractApi } from '../../../shared/ipc/contract';
import type { coworkContract } from '../../../shared/ipc/coworkContract';
import type { CoworkRunSnapshot, CoworkContentPatch } from '../../../shared/cowork/runState';
import type { PiUiEvent } from '../../../shared/cowork/piUiEvent';

type CoworkContractApi = IpcContractApi<typeof coworkContract>;

export interface CoworkApi extends Omit<
  CoworkContractApi,
  'onStreamRunState' | 'onStreamContentPatch' | 'onStreamUiEvent' | 'onSessionsChanged'
> {
  onStreamRunState: (callback: (snapshot: CoworkRunSnapshot) => void) => () => void;
  onStreamContentPatch: (callback: (patch: CoworkContentPatch) => void) => () => void;
  onStreamUiEvent: (callback: (event: PiUiEvent) => void) => () => void;
  onSessionsChanged: (
    callback: (data: {
      sessionId?: string;
      deletedSessionIds?: string[];
      agentId?: string;
    }) => void,
  ) => () => void;
}
