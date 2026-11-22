import { CompanionIpc } from '../ipc/channels';
import type { IpcContractChannels } from '../ipc/contract';
import type { companionContract } from './contract';

export const companionContractChannels: IpcContractChannels<typeof companionContract> = {
  visibility: CompanionIpc.GetVisibility,
  bootstrap: CompanionIpc.Bootstrap,
  select: CompanionIpc.Select,
  submit: CompanionIpc.Submit,
  stop: CompanionIpc.Stop,
  submitTask: CompanionIpc.SubmitTask,
  tasks: CompanionIpc.Tasks,
  stopTask: CompanionIpc.StopTask,
  chooseWorkspace: CompanionIpc.ChooseWorkspace,
  chooseFiles: CompanionIpc.ChooseFiles,
  stageFile: CompanionIpc.StageFile,
  hide: CompanionIpc.Hide,
  openWorkbench: CompanionIpc.OpenWorkbench,
};
