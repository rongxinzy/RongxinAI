import type { CcConnectCronTask } from './ccConnectCronClient';

type TriggerClient = { upsert(task: CcConnectCronTask): Promise<void>; remove(taskId: string): Promise<void> };

/** Keeps the canonical desired projection while the disposable sidecar is offline. */
export class DeferredCcConnectCronClient implements TriggerClient {
  private client: TriggerClient | null = null;
  private readonly desired = new Map<string, CcConnectCronTask>();

  async upsert(task: CcConnectCronTask): Promise<void> {
    this.desired.set(task.taskId, task);
    await this.client?.upsert(task);
  }
  async remove(taskId: string): Promise<void> {
    this.desired.delete(taskId);
    if (!this.client) return;
    try { await this.client.remove(taskId); }
    catch (error) { if (!String(error).includes('HTTP 404')) throw error; }
  }
  async attach(client: TriggerClient): Promise<void> {
    this.client = client;
    for (const task of this.desired.values()) await client.upsert(task);
  }
  detach(): void { this.client = null; }
}
