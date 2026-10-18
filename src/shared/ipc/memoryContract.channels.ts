/**
 * Channel map for the memory IPC contract, importable by the sandboxed
 * preload. Kept in a separate zod-free module because the preload bundle must
 * not require zod; the type argument locks the map to the contract's channels.
 */
import type { IpcContractChannels } from './contract';
import type { memoryContract } from './memoryContract';
import { MemoryIpcChannel } from '../memory/constants';

export const memoryContractChannels: IpcContractChannels<typeof memoryContract> = {
  list: MemoryIpcChannel.List,
  resolveSessionTitles: MemoryIpcChannel.ResolveSessionTitles,
  createManual: MemoryIpcChannel.CreateManual,
  updateManual: MemoryIpcChannel.UpdateManual,
  confirmCandidate: MemoryIpcChannel.ConfirmCandidate,
  archive: MemoryIpcChannel.Archive,
  restore: MemoryIpcChannel.Restore,
  forget: MemoryIpcChannel.Forget,
  drainOutbox: MemoryIpcChannel.DrainOutbox,
} as const;
