/**
 * Scheduled task (automation) preload surface, split from `../electron.d.ts`.
 *
 * Method signatures and data types derive from the zod IPC contract
 * (`src/shared/ipc/automationContract.ts`) — the contract is the single source
 * of truth shared with main and preload. Push subscriptions stay hand-typed.
 */
import type { IpcContractApi } from '../../../shared/ipc/contract';
import type { scheduledTasksContract } from '../../../shared/ipc/automationContract';
import type { ScheduledTaskStatusEvent, ScheduledTaskRunEvent } from '../../../scheduledTask/types';
import type { CoworkSession } from '../cowork';

type ScheduledTasksContractApi = IpcContractApi<typeof scheduledTasksContract>;

export interface ScheduledTasksApi extends Omit<
  ScheduledTasksContractApi,
  'onStatusUpdate' | 'onRunUpdate' | 'onRefresh' | 'resolveSession' | 'listChannelConversations'
> {
  /** Runs store their Pi session id directly; the resolved session is null. */
  resolveSession: (sessionKey: string) => Promise<{
    success: boolean;
    session?: CoworkSession | null;
    error?: string;
  }>;
  listChannelConversations?: (
    channel: string,
    accountId?: string,
    filterAccountId?: string,
  ) => Promise<{
    success: boolean;
    conversations?: import('../../../scheduledTask/types').ScheduledTaskConversationOption[];
    error?: string;
  }>;
  onStatusUpdate: (callback: (data: ScheduledTaskStatusEvent) => void) => () => void;
  onRunUpdate: (callback: (data: ScheduledTaskRunEvent) => void) => () => void;
  onRefresh: (callback: () => void) => () => void;
}
