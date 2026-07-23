import type {
  RunFilter,
  ScheduledTask,
  ScheduledTaskChannelOption,
  ScheduledTaskConversationOption,
  ScheduledTaskInput,
  ScheduledTaskRunEvent,
  ScheduledTaskStatusEvent,
} from '../../scheduledTask/types';
import { store } from '../store';
import {
  addOrUpdateRun,
  addTask,
  appendAllRuns,
  appendRuns,
  removeTask,
  setAllRuns,
  setError,
  setListError,
  setLoading,
  setRuns,
  setTasks,
  updateTask,
  updateTaskState,
} from '../store/slices/scheduledTaskSlice';
import { i18nService } from './i18n';

function showToast(message: string): void {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
}

function hasTaskDataAnomaly(task: ScheduledTask): boolean {
  if (task.schedule.kind === 'every') {
    const ms = task.schedule.everyMs;
    if (!Number.isFinite(ms) || ms <= 0) return true;
  }
  if (task.schedule.kind === 'at') {
    const d = new Date(task.schedule.at);
    if (!Number.isFinite(d.getTime())) return true;
  }
  const ts = task.state;
  const nums = [ts.nextRunAtMs, ts.lastRunAtMs, ts.lastDurationMs, ts.runningAtMs];
  for (const v of nums) {
    if (v !== null && !Number.isFinite(v)) return true;
  }
  return false;
}

function checkTasksForAnomalies(tasks: ScheduledTask[]): void {
  const anomalous = tasks.filter(hasTaskDataAnomaly);
  if (anomalous.length === 0) return;

  const name = anomalous[0].name;
  const msg = i18nService.t('scheduledTasksDataAnomalyWarning').replace('{name}', name);
  showToast(msg);
}

export class ScheduledTaskService {
  private cleanupFns: (() => void)[] = [];
  private initialized = false;
  private loadTasksPromise: Promise<void> | null = null;
  private reloadTasksAfterCurrent = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this.setupListeners();
    await this.loadTasks();
  }

  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
    this.initialized = false;
  }

  private setupListeners(): void {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    const cleanupStatus = api.onStatusUpdate((event: ScheduledTaskStatusEvent) => {
      store.dispatch(
        updateTaskState({
          taskId: event.taskId,
          taskState: event.state,
        }),
      );
    });
    this.cleanupFns.push(cleanupStatus);

    const cleanupRun = api.onRunUpdate((event: ScheduledTaskRunEvent) => {
      store.dispatch(addOrUpdateRun(event.run));
    });
    this.cleanupFns.push(cleanupRun);

    // Listen for full refresh events (e.g., after first poll or migration)
    const cleanupRefresh = api.onRefresh(() => {
      void this.loadTasks({ revalidate: true });
    });
    this.cleanupFns.push(cleanupRefresh);
  }

  loadTasks(options: { revalidate?: boolean } = {}): Promise<void> {
    if (this.loadTasksPromise) {
      if (options.revalidate) {
        this.reloadTasksAfterCurrent = true;
      }
      return this.loadTasksPromise;
    }

    const loadPromise = this.performLoadTasks();
    this.loadTasksPromise = loadPromise;
    void loadPromise.finally(() => {
      if (this.loadTasksPromise !== loadPromise) return;
      this.loadTasksPromise = null;
      if (this.reloadTasksAfterCurrent) {
        this.reloadTasksAfterCurrent = false;
        void this.loadTasks();
      }
    });
    return loadPromise;
  }

  private async performLoadTasks(): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    store.dispatch(setLoading(true));
    store.dispatch(setListError(null));
    try {
      const result = await api.list();
      if (result.success && result.tasks) {
        checkTasksForAnomalies(result.tasks);
        store.dispatch(setTasks(result.tasks));
      } else {
        store.dispatch(setListError(i18nService.t('scheduledTasksLoadFailedHint')));
      }
    } catch {
      store.dispatch(setListError(i18nService.t('scheduledTasksLoadFailedHint')));
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  async createTask(input: ScheduledTaskInput): Promise<string | null> {
    const api = window.electron?.scheduledTasks;
    if (!api) return null;

    try {
      const result = await api.create(input);
      if (result.success && result.task) {
        if (hasTaskDataAnomaly(result.task)) {
          const msg = i18nService
            .t('scheduledTasksDataAnomalyWarning')
            .replace('{name}', result.task.name);
          showToast(msg);
        }
        store.dispatch(addTask(result.task));
        return result.task.id;
      } else {
        throw new Error(result.error || 'Failed to create task');
      }
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  async updateTaskById(id: string, input: Partial<ScheduledTaskInput>): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      const result = await api.update(id, input);
      if (result.success && result.task) {
        store.dispatch(updateTask(result.task));
      } else if (!result.success) {
        const errorMsg = result.error || 'Failed to update task';
        store.dispatch(setError(errorMsg));
        throw new Error(errorMsg);
      }
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  async deleteTask(id: string): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      const result = await api.delete(id);
      if (result.success) {
        store.dispatch(removeTask(id));
      }
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  async toggleTask(id: string, enabled: boolean): Promise<string | null> {
    const api = window.electron?.scheduledTasks;
    if (!api) return null;

    try {
      const result = await api.toggle(id, enabled);
      if (result.success && result.task) {
        store.dispatch(updateTask(result.task));
      }
      return result.warning ?? null;
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  async runManually(id: string): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      await api.runManually(id);
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  async preflight(id: string): Promise<{
    hasChannel: boolean;
    channel?: string;
    lastDeliveryErrors?: string[] | null;
    consecutiveErrors?: number;
  } | null> {
    const api = window.electron?.scheduledTasks;
    if (!api) return null;

    try {
      const result = await api.preflight(id);
      return result.success ? (result.preflight ?? null) : null;
    } catch {
      return null;
    }
  }

  async stopTask(id: string): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      await api.stop(id);
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  async loadRuns(taskId: string, limit = 20, offset?: number, filter?: RunFilter): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      const result = await api.listRuns(taskId, limit, offset, filter);
      if (result.success && result.runs) {
        // 网关 sortDir 排序字段不可控（可能按 ts 而非 runAtMs），
        // 前端二次排序确保按 startedAt 倒序
        const sorted = [...result.runs].sort(
          (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
        );
        const hasMore = result.runs.length >= limit;
        if (offset && offset > 0) {
          store.dispatch(appendRuns({ taskId, runs: sorted, hasMore }));
        } else {
          store.dispatch(setRuns({ taskId, runs: sorted, hasMore }));
        }
      }
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
    }
  }

  async loadAllRuns(limit?: number, offset?: number, filter?: RunFilter): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      const result = await api.listAllRuns(limit, offset, filter);
      if (result.success && result.runs) {
        // 前端二次排序确保按 startedAt 倒序（网关 sortBy 字段不可控）
        const sorted = [...result.runs].sort(
          (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
        );
        const hasMore = (result.runs as unknown[]).length >= (limit ?? 50);
        if (offset && offset > 0) {
          store.dispatch(appendAllRuns({ runs: sorted, hasMore }));
        } else {
          store.dispatch(setAllRuns({ runs: sorted, hasMore }));
        }
      }
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
    }
  }

  async listChannels(): Promise<ScheduledTaskChannelOption[]> {
    const api = window.electron?.scheduledTasks;
    if (!api?.listChannels) return [];

    try {
      const result = await api.listChannels();
      return result.success && result.channels ? result.channels : [];
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      return [];
    }
  }

  async listChannelConversations(
    channel: string,
    accountId?: string,
    filterAccountId?: string,
  ): Promise<ScheduledTaskConversationOption[]> {
    const api = window.electron?.scheduledTasks;
    if (!api?.listChannelConversations) return [];

    try {
      const result = await api.listChannelConversations(channel, accountId, filterAccountId);
      return result.success && result.conversations ? result.conversations : [];
    } catch {
      return [];
    }
  }
}

export const scheduledTaskService = new ScheduledTaskService();
