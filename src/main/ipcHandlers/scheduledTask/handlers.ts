import { ipcMain } from 'electron';

import {
  DeliveryMode as STDeliveryMode,
  IpcChannel as ScheduledTaskIpc,
  PayloadKind as STPayloadKind,
  SessionTarget as STSessionTarget,
} from '../../../scheduledTask/constants';
import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';
import { PlatformRegistry } from '../../../shared/platform';
import { tryParseCcConnectScopedConversationId } from '../../im/ccConnectConversationId';
import { t } from '../../i18n';
import { listScheduledTaskChannels } from './helpers';

export interface ScheduledTaskHandlerDeps {
  getCronJobService: () => ScheduledTaskService;
  getIMGatewayManager: () => {
    getIMStore: () =>
      | {
          getSessionMapping: (
            conversationId: string,
            platform: string,
          ) =>
            | {
                coworkSessionId: string;
              }
            | undefined;
          listSessionMappings: (
            platform: string,
            accountId?: string,
          ) => Array<{
            imConversationId: string;
            platform: string;
            coworkSessionId: string;
            lastActiveAt: number;
          }>;
        }
      | undefined;
  } | null;
}

/**
 * Normalizes an announce-mode delivery payload for local channel delivery.
 * Mutates `normalizedInput` in place: sets sessionTarget, converts SystemEvent
 * payloads to AgentTurn, and restores native pi-connect conversation IDs.
 */
async function applyAnnounceDeliveryNormalization(
  normalizedInput: Record<string, any>,
): Promise<void> {
  const delivery = normalizedInput.delivery;
  if (!(delivery && delivery.mode === STDeliveryMode.Announce && delivery.channel && delivery.to)) {
    return;
  }
  const platform = PlatformRegistry.platformOfChannel(delivery.channel);
  if (!platform) return;

  normalizedInput.sessionTarget = STSessionTarget.Isolated;
  if (normalizedInput.payload?.kind === STPayloadKind.SystemEvent) {
    normalizedInput.payload = {
      kind: STPayloadKind.AgentTurn,
      message: normalizedInput.payload.text || '',
    };
  }

  const scopedConversation = tryParseCcConnectScopedConversationId(delivery.to);
  if (scopedConversation) {
    const [accountId, conversationId] = scopedConversation;
    if (delivery.accountId && delivery.accountId !== accountId) {
      throw new Error(t('scheduledTaskDeliveryAccountMismatch'));
    }
    delivery.accountId = delivery.accountId ?? accountId;
    delivery.to = conversationId;
  }
}

function cloneScheduledTaskInput<T extends Record<string, any>>(input: T): T {
  if (!input || typeof input !== 'object') return {} as T;
  const normalized: Record<string, any> = { ...input };
  if (Object.hasOwn(normalized, 'delivery') && normalized.delivery) {
    normalized.delivery = { ...normalized.delivery };
  }
  return normalized as T;
}

export function registerScheduledTaskHandlers(deps: ScheduledTaskHandlerDeps): void {
  const { getCronJobService, getIMGatewayManager } = deps;

  ipcMain.handle(ScheduledTaskIpc.List, async () => {
    try {
      const tasks = await getCronJobService().listJobs();
      return { success: true, tasks };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list tasks',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Get, async (_event, id: string) => {
    try {
      const task = await getCronJobService().getJob(id);
      return { success: true, task };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get task',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Create, async (_event, input: any) => {
    try {
      const normalizedInput = cloneScheduledTaskInput(input);
      await applyAnnounceDeliveryNormalization(normalizedInput);

      const task = await getCronJobService().addJob(normalizedInput);
      console.log(`[ScheduledTask] created task ${task.id}`);
      return { success: true, task };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create task',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Update, async (_event, id: string, input: any) => {
    try {
      const normalizedInput = cloneScheduledTaskInput(input);
      await applyAnnounceDeliveryNormalization(normalizedInput);

      const task = await getCronJobService().updateJob(id, normalizedInput);
      console.log(`[ScheduledTask] updated task ${task.id}`);
      return { success: true, task };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update task',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Delete, async (_event, id: string) => {
    try {
      await getCronJobService().removeJob(id);
      return { success: true, result: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete task',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Toggle, async (_event, id: string, enabled: boolean) => {
    try {
      const task = await getCronJobService().toggleJob(id, enabled);
      return { success: true, task };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to toggle task',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.RunManually, async (_event, id: string) => {
    try {
      await getCronJobService().runJob(id);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[IPC] Manual run failed for ${id}:`, msg);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Stop, async (_event, _id: string) => {
    // A claimed Pi Run is allowed to finish or time out on its own.
    return { success: true, result: false };
  });

  ipcMain.handle(
    ScheduledTaskIpc.ListRuns,
    async (
      _event,
      taskId: string,
      limit?: number,
      offset?: number,
      filter?: import('../../../scheduledTask/types').RunFilter,
    ) => {
      try {
        const runs = await getCronJobService().listRuns(taskId, limit, offset, filter);
        return { success: true, runs };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list runs',
        };
      }
    },
  );

  ipcMain.handle(ScheduledTaskIpc.ListDeliveries, async (_event, runId: string) => {
    try {
      const deliveries = await getCronJobService().listDeliveries(runId);
      return { success: true, deliveries };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list deliveries',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.CountRuns, async (_event, taskId: string) => {
    try {
      const count = await getCronJobService().countRuns(taskId);
      return { success: true, count };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to count runs',
      };
    }
  });

  ipcMain.handle(
    ScheduledTaskIpc.ListAllRuns,
    async (
      _event,
      limit?: number,
      offset?: number,
      filter?: import('../../../scheduledTask/types').RunFilter,
    ) => {
      try {
        const runs = await getCronJobService().listAllRuns(limit, offset, filter);
        return { success: true, runs };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list all runs',
        };
      }
    },
  );

  ipcMain.handle(ScheduledTaskIpc.ResolveSession, async (_event, sessionKey: string) => {
    try {
      if (!sessionKey) return { success: true, session: null };
      // Canonical Runs store their Pi session id directly. There is no remote
      // scheduler session authority to query by an opaque legacy session key.
      return { success: true, session: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resolve session',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.ListChannels, async () => {
    try {
      return { success: true, channels: listScheduledTaskChannels() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list channels',
      };
    }
  });

  ipcMain.handle(ScheduledTaskIpc.Preflight, async (_event, taskId: string) => {
    try {
      const task = await getCronJobService().getJob(taskId);
      if (!task) return { success: false, error: 'Task not found' };

      // Only relevant for tasks with IM channel delivery.
      const channel = task.delivery?.channel;
      if (!channel || task.delivery?.mode === 'none') {
        return { success: true, preflight: { hasChannel: false } };
      }

      const [latestRun] = await getCronJobService().listRuns(taskId, 1);
      const [latestDelivery] = latestRun
        ? await getCronJobService().listDeliveries(latestRun.id)
        : [];

      return {
        success: true,
        preflight: {
          hasChannel: true,
          channel,
          latestDelivery: latestDelivery ?? null,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Preflight failed',
      };
    }
  });

  ipcMain.handle(
    ScheduledTaskIpc.ListChannelConversations,
    async (_event, channel: string, accountId?: string, filterAccountId?: string) => {
      try {
        const platform = PlatformRegistry.platformOfChannel(channel);
        if (!platform) return { success: true, conversations: [] };
        const imStore = getIMGatewayManager()?.getIMStore();
        if (!imStore) return { success: true, conversations: [] };
        const mappings = imStore.listSessionMappings(platform, filterAccountId ?? accountId);
        const conversations = mappings.map(m => ({
          conversationId:
            tryParseCcConnectScopedConversationId(m.imConversationId)?.[1] ?? m.imConversationId,
          platform: m.platform,
          coworkSessionId: m.coworkSessionId,
          lastActiveAt: m.lastActiveAt,
        }));
        return { success: true, conversations };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list conversations',
        };
      }
    },
  );
}
