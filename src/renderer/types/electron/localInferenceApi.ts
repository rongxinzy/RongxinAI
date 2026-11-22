/**
 * Local inference preload surface, split from `../electron.d.ts`.
 *
 * Covers the llama.cpp runtime, marketplace search and hardware snapshots.
 */
import type {
  LlamaCppModelLaunchLogClearedEvent,
  LlamaCppModelLaunchLogEvent,
  LlamaCppModelLaunchLogWindowTarget,
} from '../../../shared/llamacpp';
import type { LlamaCppStatusSnapshot, LlamaCppInstallProgress } from '../../../shared/llamacpp';
import type { IpcContractApi } from '../../../shared/ipc/contract';
import type { hardwareContract } from '../../../shared/ipc/hardwareContract';
import type { marketplaceContract } from '../../../shared/marketplace/contract';
import type { llamacppContract } from '../../../shared/ipc/llamacppContract';

/**
 * llama.cpp surface: invoke methods derive from the zod contract (work
 * package M.4); push subscriptions stay hand-typed.
 */
export interface LlamaCppApi extends Omit<
  IpcContractApi<typeof llamacppContract>,
  | 'onStatusChanged'
  | 'onModelBindingsChanged'
  | 'onInstallProgress'
  | 'onModelLaunchLog'
  | 'onModelLaunchLogCleared'
  | 'onModelLaunchLogWindowTargetChanged'
> {
  onStatusChanged: (callback: (snapshot: LlamaCppStatusSnapshot) => void) => () => void;
  onModelBindingsChanged: (callback: () => void) => () => void;
  onInstallProgress: (callback: (progress: LlamaCppInstallProgress) => void) => () => void;
  onModelLaunchLog: (callback: (event: LlamaCppModelLaunchLogEvent) => void) => () => void;
  onModelLaunchLogCleared: (
    callback: (event: LlamaCppModelLaunchLogClearedEvent) => void,
  ) => () => void;
  onModelLaunchLogWindowTargetChanged: (
    callback: (target: LlamaCppModelLaunchLogWindowTarget) => void,
  ) => () => void;
}

export interface MarketplaceApi extends IpcContractApi<typeof marketplaceContract> {}

export type HardwareApi = IpcContractApi<typeof hardwareContract>;
