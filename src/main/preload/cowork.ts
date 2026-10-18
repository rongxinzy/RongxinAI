import type { IpcContractApi } from '../../shared/ipc/contract';
import type { coworkContract } from '../../shared/ipc/coworkContract';
import type { workbenchTaskContract } from '../../shared/ipc/workbenchTaskContract';
import type { todoContract } from '../../shared/ipc/todoContract';
import { coworkContractChannels } from '../../shared/ipc/coworkContract.channels';
import { workbenchTaskContractChannels } from '../../shared/ipc/workbenchTaskContract.channels';
import { todoContractChannels } from '../../shared/ipc/todoContract.channels';
import type { CoworkRunSnapshot, CoworkContentPatch } from '../../shared/cowork/runState';
import type { PiUiEvent } from '../../shared/cowork/piUiEvent';
import { CoworkStreamIpc } from '../../shared/ipc/channels';
import { TodoIpc } from '../../shared/todo';
import { WorkbenchTaskIpc, type WorkbenchTaskChangedEvent } from '../../shared/workbenchTask';
import { onPush } from './pushChannel';
import { createIpcInvokers } from './createIpcInvokers';

// Cowork sessions, workbench tasks, and todos. Invoke methods come from the
// contract channel maps via createIpcInvokers; push subscriptions
// (onStream* / onSessionsChanged / onChanged) stay hand-wired below.
export const coworkApi = {
  cowork: {
    ...createIpcInvokers(coworkContractChannels),
    onStreamRunState: (callback: (snapshot: CoworkRunSnapshot) => void) =>
      onPush(CoworkStreamIpc.RunState, callback),
    onStreamContentPatch: (callback: (patch: CoworkContentPatch) => void) =>
      onPush(CoworkStreamIpc.ContentPatch, callback),
    onStreamUiEvent: (callback: (event: PiUiEvent) => void) =>
      onPush(CoworkStreamIpc.UiEvent, callback),
    onSessionsChanged: (
      callback: (data: {
        sessionId?: string;
        deletedSessionIds?: string[];
        agentId?: string;
      }) => void,
    ) => onPush(CoworkStreamIpc.SessionsChanged, callback),
  } as IpcContractApi<typeof coworkContract> & {
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
  },

  workbenchTask: {
    ...createIpcInvokers(workbenchTaskContractChannels),
    onChanged: (callback: (event: WorkbenchTaskChangedEvent) => void) =>
      onPush(WorkbenchTaskIpc.Changed, callback),
  } as IpcContractApi<typeof workbenchTaskContract> & {
    onChanged: (callback: (event: WorkbenchTaskChangedEvent) => void) => () => void;
  },

  todo: {
    ...createIpcInvokers(todoContractChannels),
    onChanged: (callback: (event: import('../../shared/todo').TodoChangedEvent) => void) =>
      onPush(TodoIpc.Changed, callback),
  } as IpcContractApi<typeof todoContract> & {
    onChanged: (
      callback: (event: import('../../shared/todo').TodoChangedEvent) => void,
    ) => () => void;
  },
};
