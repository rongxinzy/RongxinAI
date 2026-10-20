import net from 'node:net';

export const MAGPIE_AGENT_MODEL_FIELDS = new Set([
  'model',
  'large',
  'small',
  'executor',
  'planner',
]);

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const maskApiKey = (key?: string) =>
  !key ? undefined : key.length <= 8 ? '****' : `${key.slice(0, 3)}...${key.slice(-4)}`;

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(error => (error ? reject(error) : resolve(port)));
    });
  });
}
