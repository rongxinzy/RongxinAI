import type { Schedule } from './types';
import { CcConnectProtocol, type CcConnectHealth } from '../shared/ccConnect/constants';
import { createCcConnectProtocolHeaders, isCcConnectHealth } from '../shared/ccConnect/protocol';

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

  async healthCheck(expectedPid?: number): Promise<CcConnectHealth> {
    const response = await this.request('/v1/cc-connect/cron/health', { method: 'GET' }, 200);
    const health: unknown = await response.json();
    if (!isCcConnectHealth(health) || !health.capabilities.includes(CcConnectProtocol.Capability.TriggerOnlyCron)) {
      throw new Error('cc-connect returned an incompatible health contract');
    }
    if (expectedPid !== undefined && health.pid !== expectedPid) {
      throw new Error(`cc-connect health PID ${health.pid} does not match child PID ${expectedPid}`);
    }
    if (health.parentPid !== process.pid) {
      throw new Error(`cc-connect parent PID ${health.parentPid} does not match desktop PID ${process.pid}`);
    }
    return health;
  }

  private async request(path: string, init: RequestInit, expectedStatus = 204): Promise<Response> {
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        ...createCcConnectProtocolHeaders(),
        ...init.headers,
      },
    });
    if (response.status !== expectedStatus) throw new Error(`cc-connect cron control returned HTTP ${response.status}`);
    return response;
  }
}
