/**
 * Channel map for the marketplace IPC contract, importable by the sandboxed
 * preload. Kept in a separate zod-free module because the preload bundle must
 * not require zod; the type argument locks the map to the contract's channels.
 */
import type { IpcContractChannels } from '../ipc/contract';
import type { marketplaceContract } from './contract';
import { MarketplaceIpcChannel } from './constants';

export const marketplaceContractChannels: IpcContractChannels<typeof marketplaceContract> = {
  search: MarketplaceIpcChannel.Search,
  cancelSearch: MarketplaceIpcChannel.CancelSearch,
} as const;
