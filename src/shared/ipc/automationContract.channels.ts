/**
 * Channel map for the automation IPC contracts (scheduled tasks + activity),
 * importable by the sandboxed preload. Kept in a separate zod-free module
 * because the preload bundle must not require zod; the type arguments lock the
 * maps to the contracts' channels.
 */
import type { IpcContractChannels } from './contract';
import type { activityContract, scheduledTasksContract } from './automationContract';
import { IpcChannel as ScheduledTaskIpc } from '../../scheduledTask/constants';
import { ActivityIpc } from '../activity/constants';

export const scheduledTasksContractChannels: IpcContractChannels<typeof scheduledTasksContract> = {
  list: ScheduledTaskIpc.List,
  create: ScheduledTaskIpc.Create,
  update: ScheduledTaskIpc.Update,
  delete: ScheduledTaskIpc.Delete,
  toggle: ScheduledTaskIpc.Toggle,
  runManually: ScheduledTaskIpc.RunManually,
  preflight: ScheduledTaskIpc.Preflight,
  listRuns: ScheduledTaskIpc.ListRuns,
  listDeliveries: ScheduledTaskIpc.ListDeliveries,
  listAllRuns: ScheduledTaskIpc.ListAllRuns,
  listChannels: ScheduledTaskIpc.ListChannels,
  listChannelConversations: ScheduledTaskIpc.ListChannelConversations,
} as const;

export const activityContractChannels: IpcContractChannels<typeof activityContract> = {
  list: ActivityIpc.List,
} as const;
