import type { ScheduledTaskInput } from '../../../scheduledTask/types';
import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';
import { handleIpcContract } from '../../ipc/handleIpcContract';
import { scheduledTasksContract } from '../../../shared/ipc/automationContract';

export interface ScheduledTaskHandlerDeps {
  getScheduledTaskService(): ScheduledTaskService;
  resolveSession?(sessionKey: string): Record<string, unknown> | null;
}

const failure = (error: unknown) => ({
  success: false as const,
  error: error instanceof Error ? error.message : String(error),
});

export function registerScheduledTaskHandlers(deps: ScheduledTaskHandlerDeps): void {
  const service = deps.getScheduledTaskService;
  handleIpcContract(scheduledTasksContract, {
    list: async () => {
      try {
        return { success: true, tasks: await service().listJobs() };
      } catch (error) {
        return failure(error);
      }
    },
    get: async (_event, id) => {
      try {
        return { success: true, task: await service().getJob(id) };
      } catch (error) {
        return failure(error);
      }
    },
    create: async (_event, input) => {
      try {
        return { success: true, task: await service().addJob(input as ScheduledTaskInput) };
      } catch (error) {
        return failure(error);
      }
    },
    update: async (_event, id, input) => {
      try {
        return { success: true, task: await service().updateJob(id, input) };
      } catch (error) {
        return failure(error);
      }
    },
    delete: async (_event, id) => {
      try {
        await service().removeJob(id);
        return { success: true, result: true };
      } catch (error) {
        return failure(error);
      }
    },
    toggle: async (_event, id, enabled) => {
      try {
        return { success: true, task: await service().toggleJob(id, enabled) };
      } catch (error) {
        return failure(error);
      }
    },
    runManually: async (_event, id) => {
      try {
        await service().runJob(id);
        return { success: true };
      } catch (error) {
        return failure(error);
      }
    },
    stop: async (_event, id) => {
      try {
        return { success: true, result: await service().stopJob(id) };
      } catch (error) {
        return failure(error);
      }
    },
    listRuns: async (_event, id, limit, offset, filter) => {
      try {
        return { success: true, runs: await service().listRuns(id, limit, offset, filter) };
      } catch (error) {
        return failure(error);
      }
    },
    countRuns: async (_event, id) => {
      try {
        return { success: true, count: await service().countRuns(id) };
      } catch (error) {
        return failure(error);
      }
    },
    listAllRuns: async (_event, limit, offset, filter) => {
      try {
        return { success: true, runs: await service().listAllRuns(limit, offset, filter) };
      } catch (error) {
        return failure(error);
      }
    },
    resolveSession: async (_event, key) => {
      try {
        return { success: true, session: deps.resolveSession?.(key) ?? null };
      } catch (error) {
        return failure(error);
      }
    },
  });
}
