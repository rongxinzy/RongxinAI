import {
  DeliveryMode as STDeliveryMode,
  PayloadKind as STPayloadKind,
} from '../../../scheduledTask/constants';
import type { RunFilter, ScheduledTaskInput } from '../../../scheduledTask/types';
import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';
import { PlatformRegistry } from '../../../shared/platform';
import { tryParseCcConnectScopedConversationId } from '../../im/ccConnectConversationId';
import { t } from '../../i18n';
import { handleIpcContract } from '../../ipc/handleIpcContract';
import { scheduledTasksContract } from '../../../shared/ipc/automationContract';
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
 * Mutates `normalizedInput` in place: converts SystemEvent payloads to AgentTurn
 * and restores native pi-connect conversation IDs. Execution binding stays
 * independent from the delivery route.
 */
type MutableScheduledTaskInput = ScheduledTaskInput | Partial<ScheduledTaskInput>;

async function applyAnnounceDeliveryNormalization(
  normalizedInput: ScheduledTaskInput | Partial<ScheduledTaskInput>,
): Promise<void> {
  const delivery = normalizedInput.delivery;
  if (!(delivery && delivery.mode === STDeliveryMode.Announce && delivery.channel && delivery.to)) {
    return;
  }
  const platform = PlatformRegistry.platformOfChannel(delivery.channel);
  if (!platform) return;

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

function cloneScheduledTaskInput<T extends ScheduledTaskInput | Partial<ScheduledTaskInput>>(
  input: T,
): T {
  const normalized = { ...input };
  if (Object.hasOwn(normalized, 'delivery') && normalized.delivery) {
    normalized.delivery = { ...normalized.delivery };
  }
  return normalized;
}

export function registerScheduledTaskHandlers(deps: ScheduledTaskHandlerDeps): void {
  const { getCronJobService, getIMGatewayManager } = deps;

  handleIpcContract(scheduledTasksContract, {
    list: async () => {
      try {
        const tasks = await getCronJobService().listJobs();
        return { success: true, tasks };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list tasks',
        };
      }
    },

    get: async (_event, id) => {
      try {
        const task = await getCronJobService().getJob(id);
        return { success: true, task };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get task',
        };
      }
    },

    create: async (_event, input) => {
      try {
        const taskInput = input as ScheduledTaskInput;
        const normalizedInput = cloneScheduledTaskInput(taskInput);
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
    },

    update: async (_event, id, input) => {
      try {
        const normalizedInput = cloneScheduledTaskInput(input as Partial<ScheduledTaskInput>);
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
    },

    delete: async (_event, id) => {
      try {
        await getCronJobService().removeJob(id);
        return { success: true, result: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete task',
        };
      }
    },

    toggle: async (_event, id, enabled) => {
      try {
        const task = await getCronJobService().toggleJob(id, enabled);
        return { success: true, task };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to toggle task',
        };
      }
    },

    runManually: async (_event, id) => {
      try {
        await getCronJobService().runJob(id);
        return { success: true };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[IPC] Manual run failed for ${id}:`, msg);
        return { success: false, error: msg };
      }
    },

    stop: async (_event, _id) => {
      // A claimed Pi Run is allowed to finish or time out on its own.
      return { success: true, result: false };
    },

    listRuns: async (_event, taskId, limit?, offset?, filter?: RunFilter) => {
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

    listDeliveries: async (_event, runId) => {
      try {
        const deliveries = await getCronJobService().listDeliveries(runId);
        return { success: true, deliveries };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list deliveries',
        };
      }
    },

    countRuns: async (_event, taskId) => {
      try {
        const count = await getCronJobService().countRuns(taskId);
        return { success: true, count };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to count runs',
        };
      }
    },

    listAllRuns: async (_event, limit?, offset?, filter?: RunFilter) => {
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

    resolveSession: async (_event, sessionKey) => {
      try {
        if (!sessionKey) return { success: true, session: null };
        // Canonical Runs store their Pi session id directly. There is no remote
        // scheduler session authority to query by an opaque legacy session key.
        return { success: true, session: null as unknown as Record<string, unknown> | null };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to resolve session',
        };
      }
    },

    listChannels: async () => {
      try {
        return { success: true, channels: listScheduledTaskChannels() };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list channels',
        };
      }
    },

    preflight: async (_event, taskId) => {
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
    },

    listChannelConversations: async (_event, channel, accountId?, filterAccountId?) => {
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
  });
}
