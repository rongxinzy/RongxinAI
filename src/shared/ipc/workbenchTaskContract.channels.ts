/**
 * Channel map for the workbench task IPC contract, importable by the sandboxed
 * preload. Kept in a separate zod-free module because the preload bundle must
 * not require zod; the type argument locks the map to the contract's channels.
 */
import type { IpcContractChannels } from './contract';
import type { workbenchTaskContract } from './workbenchTaskContract';
import { WorkbenchTaskIpc } from '../workbenchTask';

export const workbenchTaskContractChannels: IpcContractChannels<typeof workbenchTaskContract> = {
  getCurrent: WorkbenchTaskIpc.GetCurrent,
  getDetail: WorkbenchTaskIpc.GetDetail,
  listForSession: WorkbenchTaskIpc.ListForSession,
  exportAudit: WorkbenchTaskIpc.ExportAudit,
  resume: WorkbenchTaskIpc.Resume,
  retry: WorkbenchTaskIpc.Retry,
  accept: WorkbenchTaskIpc.Accept,
  respondToApproval: WorkbenchTaskIpc.RespondToApproval,
} as const;
