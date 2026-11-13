import net from 'node:net';

const DEFAULT_GATEWAY_PORT = 18_425;

async function portFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function portAvailableForMode(port: number, lanAccess = false): Promise<boolean> {
  if (!(await portFree(port, '127.0.0.1'))) return false;
  if (lanAccess && !(await portFree(port, '0.0.0.0'))) return false;
  return true;
}

async function freePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(error => (error ? reject(error) : resolve(port)));
    });
  });
}

export interface MagpieGatewayPortStore {
  read(): number | undefined;
  write(port: number): void;
}

export interface ResolveMagpieGatewayPortOptions {
  lanAccess?: boolean;
  excludePorts?: Iterable<number>;
}

/** Picks a stable gateway port, reusing the persisted value when still free for the target host mode. */
export async function resolveMagpieGatewayPort(
  store?: MagpieGatewayPortStore,
  options?: ResolveMagpieGatewayPortOptions,
): Promise<number> {
  const lanAccess = options?.lanAccess === true;
  const excluded = new Set(options?.excludePorts);
  const persisted = store?.read();
  if (
    typeof persisted === 'number' &&
    persisted > 0 &&
    persisted <= 65535 &&
    !excluded.has(persisted)
  ) {
    if (await portAvailableForMode(persisted, lanAccess)) return persisted;
  }
  if (
    !excluded.has(DEFAULT_GATEWAY_PORT) &&
    (await portAvailableForMode(DEFAULT_GATEWAY_PORT, lanAccess))
  ) {
    store?.write(DEFAULT_GATEWAY_PORT);
    return DEFAULT_GATEWAY_PORT;
  }
  const bindHost = lanAccess ? '0.0.0.0' : '127.0.0.1';
  let allocated = await freePort(bindHost);
  for (
    let attempt = 0;
    attempt < 5 && (excluded.has(allocated) || !(await portAvailableForMode(allocated, lanAccess)));
    attempt++
  ) {
    allocated = await freePort(bindHost);
  }
  store?.write(allocated);
  return allocated;
}
