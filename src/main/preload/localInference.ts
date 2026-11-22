import { LlamaCppIpcChannel } from '../../shared/llamacpp/constants';
import type { LlamaCppInstallProgress } from '../../shared/llamacpp/types';
import { hardwareContractChannels } from '../../shared/ipc/hardwareContract.channels';
import { llamacppContractChannels } from '../../shared/ipc/llamacppContract.channels';
import { createIpcInvokers } from './createIpcInvokers';
import { onPush, onPushVoid } from './pushChannel';

// Local inference and hardware probes.
export const localInferenceApi = {
  llamacpp: {
    ...createIpcInvokers(llamacppContractChannels),
    onStatusChanged: (callback: (snapshot: unknown) => void) =>
      onPush(LlamaCppIpcChannel.StatusChanged, callback),
    onModelBindingsChanged: (callback: () => void) =>
      onPushVoid(LlamaCppIpcChannel.ModelBindingsChanged, callback),
    onInstallProgress: (callback: (progress: LlamaCppInstallProgress) => void) =>
      onPush(LlamaCppIpcChannel.InstallProgress, callback),
    onModelLaunchLog: (callback: (event: unknown) => void) =>
      onPush(LlamaCppIpcChannel.ModelLaunchLog, callback),
    onModelLaunchLogCleared: (callback: (event: unknown) => void) =>
      onPush(LlamaCppIpcChannel.ModelLaunchLogCleared, callback),
    onModelLaunchLogWindowTargetChanged: (callback: (target: unknown) => void) =>
      onPush(LlamaCppIpcChannel.ModelLaunchLogWindowTargetChanged, callback),
  },

  hardware: {
    ...createIpcInvokers(hardwareContractChannels),
  },
};
