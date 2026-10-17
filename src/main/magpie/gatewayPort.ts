import net from 'node:net';

const DEFAULT_GATEWAY_PORT = 18_425;

async function portFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(error => (error ? reject(error) : resolve(port)));
    });
  });
}

export interface MagpieGatewayPortStore {
  read(): number | undefined;
  write(port: number): void;
}

/** Picks a stable loopback gateway port, reusing the persisted value when still free. */
export async function resolveMagpieGatewayPort(store?: MagpieGatewayPortStore): Promise<number> {
  const persisted = store?.read();
  if (typeof persisted === 'number' && persisted > 0 && persisted <= 65535) {
    if (await portFree(persisted)) return persisted;
  }
  if (await portFree(DEFAULT_GATEWAY_PORT)) {
    store?.write(DEFAULT_GATEWAY_PORT);
    return DEFAULT_GATEWAY_PORT;
  }
  const allocated = await freePort();
  store?.write(allocated);
  return allocated;
}
