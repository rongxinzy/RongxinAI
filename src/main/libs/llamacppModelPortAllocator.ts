const LLAMACPP_MODEL_PORT_RANGE = {
  First: 18081,
  Last: 18180,
} as const;

export type LlamaCppModelPortLease = {
  modelName: string;
  port: number;
};

/** Assigns distinct candidate ports inside the application-owned model range. */
export class LlamaCppModelPortAllocator {
  private readonly leasesByModel = new Map<string, LlamaCppModelPortLease>();
  private readonly leasedPorts = new Set<number>();

  async reserve(modelName: string): Promise<LlamaCppModelPortLease> {
    const normalizedModelName = modelName.trim();
    if (!normalizedModelName) throw new Error('Model name is required.');
    const existing = this.leasesByModel.get(normalizedModelName);
    if (existing) return existing;

    for (let port = LLAMACPP_MODEL_PORT_RANGE.First; port <= LLAMACPP_MODEL_PORT_RANGE.Last; port += 1) {
      if (this.leasedPorts.has(port) || !(await isLoopbackPortAvailable(port))) continue;
      const lease = { modelName: normalizedModelName, port };
      this.leasesByModel.set(normalizedModelName, lease);
      this.leasedPorts.add(port);
      return lease;
    }
    throw new Error('No local model ports are available.');
  }

  release(modelName: string): void {
    const normalizedModelName = modelName.trim();
    const lease = this.leasesByModel.get(normalizedModelName);
    if (!lease) return;
    this.leasesByModel.delete(normalizedModelName);
    this.leasedPorts.delete(lease.port);
  }

  releaseAll(): void {
    this.leasesByModel.clear();
    this.leasedPorts.clear();
  }
}

async function isLoopbackPortAvailable(port: number): Promise<boolean> {
  return await new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(error => resolve(!error));
    });
  });
}
import net from 'node:net';
