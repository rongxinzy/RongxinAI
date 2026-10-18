import { ipcRenderer } from 'electron';

import { DingTalkInstallIpc, FeishuInstallIpc, ImIpc } from '../../shared/ipc/channels';
import type { IpcContractApi } from '../../shared/ipc/contract';
import type { imContract, imInstanceContract } from '../../shared/ipc/imContract';
import {
  dingtalkInstallContractChannels,
  feishuInstallContractChannels,
  imContractChannels,
  imInstanceContractChannels,
} from '../../shared/ipc/imContract.channels';
import { onPush } from './pushChannel';
import { createIpcInvokers } from './createIpcInvokers';

// IM gateways, login/install flows, and per-platform instances. Gateway and
// instance invoke methods come from the contract channel maps; the install
// helpers adapt flat renderer args to the contract's object payloads, and push
// subscriptions stay hand-wired.
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

  feishu: {
    install: {
      ...createIpcInvokers(feishuInstallContractChannels),
      // The renderer surface keeps flat args; adapt to the contract payload.
      verify: (appId: string, appSecret: string) =>
        ipcRenderer.invoke(FeishuInstallIpc.Verify, { appId, appSecret }),
    },
  },

  dingtalk: {
    install: {
      ...createIpcInvokers(dingtalkInstallContractChannels),
      // The renderer surface keeps flat args; adapt to the contract payloads.
      qrcode: () => ipcRenderer.invoke(DingTalkInstallIpc.Qrcode),
      poll: (deviceCode: string) => ipcRenderer.invoke(DingTalkInstallIpc.Poll, { deviceCode }),
      verify: (clientId: string, clientSecret: string) =>
        ipcRenderer.invoke(DingTalkInstallIpc.Verify, { clientId, clientSecret }),
    },
  },
};
