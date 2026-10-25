/**
 * Channel map for the Strata IPC contract, importable by the sandboxed
 * preload (zod-free; see contract.ts layering notes).
 */
import type { IpcContractChannels } from './contract';
import type { strataContract } from './strataContract';
import { StrataIpcChannel } from '../strata/constants';

export const strataContractChannels: IpcContractChannels<typeof strataContract> = {
  isBundled: StrataIpcChannel.IsBundled,
  catalog: StrataIpcChannel.Catalog,
  status: StrataIpcChannel.Status,
  start: StrataIpcChannel.Start,
  stop: StrataIpcChannel.Stop,
  getServiceConfig: StrataIpcChannel.ServiceConfigGet,
  setServiceConfig: StrataIpcChannel.ServiceConfigSet,
};
