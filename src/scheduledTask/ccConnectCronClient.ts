import type { Schedule } from './types';

/** Internal project identity for the credential-free canonical scheduler clock. */
export const SchedulerClockAccount = '__zhiyuan_scheduler__';

export type CcConnectCronTask = {
  accountId: string;
  taskId: string;
  scheduleVersion: string;
  schedule: Schedule;
};

/** Minimal authenticated control-plane client; it never sends payloads or commands. */
export class CcConnectCronClient {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  async upsert(task: CcConnectCronTask): Promise<void> {
    // accountId selects the local sidecar process and is never part of the
    // sidecar protocol. The process is already bound to that one account.
    const { accountId: _accountId, ...payload } = task;
    await this.request('/v1/cc-connect/cron/tasks', { method: 'POST', body: JSON.stringify(payload) });
  }

  async remove(task: Pick<CcConnectCronTask, 'taskId'>): Promise<void> {
    await this.request(`/v1/cc-connect/cron/tasks/${encodeURIComponent(task.taskId)}`, { method: 'DELETE' });
  }

  async reconcile(tasks: readonly CcConnectCronTask[]): Promise<void> {
    for (const task of tasks) await this.upsert(task);
  }

  async healthCheck(): Promise<void> {
    await this.request('/v1/cc-connect/cron/health', { method: 'GET' });
  }

  private async request(path: string, init: RequestInit): Promise<void> {
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', ...init.headers },
    });
    if (response.status !== 204) throw new Error(`cc-connect cron control returned HTTP ${response.status}`);
  }
}
