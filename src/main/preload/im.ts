import { ImIpc } from '../../shared/ipc/channels';
import type { IpcContractApi } from '../../shared/ipc/contract';
import type { imContract, imInstanceContract } from '../../shared/ipc/imContract';
import {
  imContractChannels,
  imInstanceContractChannels,
} from '../../shared/ipc/imContract.channels';
import { onPush } from './pushChannel';
import { createIpcInvokers } from './createIpcInvokers';

// IM gateways, login/install flows, and per-platform instances. Gateway and
// instance invoke methods come from the contract channel maps.
export const imApi = {
  im: {
    ...createIpcInvokers(imContractChannels),
    ...createIpcInvokers(imInstanceContractChannels),
    onStatusChange: (callback: (status: unknown) => void) => onPush(ImIpc.StatusChange, callback),
    onMessageReceived: (callback: (message: unknown) => void) =>
      onPush(ImIpc.MessageReceived, callback),
  } as IpcContractApi<typeof imContract> &
    IpcContractApi<typeof imInstanceContract> & {
      onStatusChange: (callback: (status: unknown) => void) => () => void;
      onMessageReceived: (callback: (message: unknown) => void) => () => void;
    },
};
