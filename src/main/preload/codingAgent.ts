import { CodingAgentIpc } from '../../shared/codingAgent';
import type {
  CodingPendingMessagesChangedEvent,
  CodingRoomEventDelta,
  CodingRoomSnapshot,
} from '../../shared/codingAgent';
import type { IpcContractApi } from '../../shared/ipc/contract';
import type { codingAgentContract } from '../../shared/ipc/codingAgentContract';
import { codingAgentContractChannels } from '../../shared/ipc/codingAgentContract.channels';
import { onPush } from './pushChannel';
import { createIpcInvokers } from './createIpcInvokers';

// Coding agent workspaces, lanes, git flows, and auth terminals. Invoke
// methods come from the contract channel map; push subscriptions stay
// hand-wired.
export const codingAgentApi = {
  codingAgent: {
    ...createIpcInvokers(codingAgentContractChannels),
    onChanged: (callback: (snapshot: CodingRoomSnapshot) => void) =>
      onPush(CodingAgentIpc.Changed, callback),
    onEventDelta: (callback: (delta: CodingRoomEventDelta) => void) =>
      onPush(CodingAgentIpc.EventDelta, callback),
    onPendingMessagesChanged: (callback: (event: CodingPendingMessagesChangedEvent) => void) =>
      onPush(CodingAgentIpc.PendingMessagesChanged, callback),
    onAuthTerminalData: (callback: (event: { id: string; data: string }) => void) =>
      onPush(CodingAgentIpc.AuthTerminalData, callback),
    onAuthTerminalExit: (
      callback: (event: {
        id: string;
        profileId: string;
        methodId: string;
        exitCode: number;
        signal?: number;
      }) => void,
    ) => onPush(CodingAgentIpc.AuthTerminalExit, callback),
  } as IpcContractApi<typeof codingAgentContract> & {
    onChanged: (callback: (snapshot: CodingRoomSnapshot) => void) => () => void;
    onEventDelta: (callback: (delta: CodingRoomEventDelta) => void) => () => void;
    onPendingMessagesChanged: (
      callback: (event: CodingPendingMessagesChangedEvent) => void,
    ) => () => void;
    onAuthTerminalData: (callback: (event: { id: string; data: string }) => void) => () => void;
    onAuthTerminalExit: (
      callback: (event: {
        id: string;
        profileId: string;
        methodId: string;
        exitCode: number;
        signal?: number;
      }) => void,
    ) => () => void;
  },
};
