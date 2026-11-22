import { companionContractChannels } from '../../shared/companion/contract.channels';
import type { CompanionNavigationApi, CompanionWindowApi } from '../../shared/companion/types';
import { CompanionIpc } from '../../shared/ipc/channels';
import { createIpcInvokers } from './createIpcInvokers';
import { onPush, onPushVoid } from './pushChannel';

export const companionApi = {
  companion: {
    ...createIpcInvokers(companionContractChannels),
    onFocus: listener => onPushVoid(CompanionIpc.Focus, listener),
    onContext: listener => onPush(CompanionIpc.Context, listener),
    onVisibility: listener => onPush(CompanionIpc.Visibility, listener),
    onTasks: listener => onPush(CompanionIpc.TasksChanged, listener),
    onChanged: listener => onPushVoid(CompanionIpc.Changed, listener),
  } as CompanionWindowApi,
};

export const companionNavigationApi = {
  companion: {
    onWorkbench: listener => onPushVoid(CompanionIpc.Workbench, listener),
  } as CompanionNavigationApi,
};
