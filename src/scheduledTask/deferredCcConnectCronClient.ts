import type { CcConnectCronTask } from './ccConnectCronClient';

type TriggerClient = { upsert(task: CcConnectCronTask): Promise<void>; remove(task: Pick<CcConnectCronTask, 'taskId'>): Promise<void> };

/** Keeps the canonical desired projection while the disposable sidecar is offline. */
export class DeferredCcConnectCronClient implements TriggerClient {
  private readonly clients = new Map<string, TriggerClient>();
  private readonly desired = new Map<string, CcConnectCronTask>();

  async upsert(task: CcConnectCronTask): Promise<void> {
    this.desired.set(`${task.accountId}:${task.taskId}`, task);
    await this.clients.get(task.accountId)?.upsert(task);
  }
  async remove(task: CcConnectCronTask): Promise<void> {
    this.desired.delete(`${task.accountId}:${task.taskId}`);
    const client = this.clients.get(task.accountId);
    if (!client) return;
    try { await client.remove(task); }
    catch (error) { if (!String(error).includes('HTTP 404')) throw error; }
  }
  async attach(accountId: string, client: TriggerClient): Promise<void> {
    this.clients.set(accountId, client);
    for (const task of this.desired.values()) if (task.accountId === accountId) await client.upsert(task);
  }
  detach(accountId: string): void { this.clients.delete(accountId); }
}
