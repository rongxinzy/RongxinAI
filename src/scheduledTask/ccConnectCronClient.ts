export type CcConnectCronTask = {
  taskId: string;
  scheduleVersion: string;
  expression: string;
  timezone?: string;
};

/** Minimal authenticated control-plane client; it never sends payloads or commands. */
export class CcConnectCronClient {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  async upsert(task: CcConnectCronTask): Promise<void> {
    await this.request('/v1/cc-connect/cron/tasks', { method: 'POST', body: JSON.stringify(task) });
  }

  async remove(taskId: string): Promise<void> {
    await this.request(`/v1/cc-connect/cron/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
  }

  private async request(path: string, init: RequestInit): Promise<void> {
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', ...init.headers },
    });
    if (response.status !== 204) throw new Error(`cc-connect cron control returned HTTP ${response.status}`);
  }
}
