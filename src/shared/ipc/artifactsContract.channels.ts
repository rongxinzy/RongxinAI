/**
 * Channel map for the artifacts IPC contract, importable by the sandboxed
 * preload. Kept in a separate zod-free module because the preload bundle must
 * not require zod; the type argument locks the map to the contract's channels.
 */
import type { IpcContractChannels } from './contract';
import type { artifactsContract } from './artifactsContract';
import { ArtifactIpc } from './channels';

export const artifactsContractChannels: IpcContractChannels<typeof artifactsContract> = {
  list: ArtifactIpc.List,
} as const;
