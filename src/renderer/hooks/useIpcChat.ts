import { type UIMessage, useChat } from '@ai-sdk/react';

import { IpcChatTransport, type IpcChatTransportOptions } from '../services/ipcChatTransport';

export type UseIpcChatOptions = IpcChatTransportOptions;

export function useIpcChat(options: UseIpcChatOptions = {}) {
  return useChat({
    transport: new IpcChatTransport(options),
  });
}

export type { UIMessage };
