import { describe, expect, it } from 'vitest';
import net from 'node:net';
import { resolveMagpieGatewayPort } from './gatewayPort';

async function listen(port: number): Promise<() => Promise<void>> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return () =>
    new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
}

describe('resolveMagpieGatewayPort', () => {
  it('reuses a persisted free port', async () => {
    let stored: number | undefined;
    const first = await resolveMagpieGatewayPort({
      read: () => stored,
      write: port => {
        stored = port;
      },
    });
    const second = await resolveMagpieGatewayPort({
      read: () => stored,
      write: port => {
        stored = port;
      },
    });
    expect(second).toBe(first);
  });

  it('allocates another port when the persisted value is taken', async () => {
    let stored = 38441;
    const release = await listen(stored);
    try {
      const port = await resolveMagpieGatewayPort({
        read: () => stored,
        write: value => {
          stored = value;
        },
      });
      expect(port).not.toBe(38441);
      expect(stored).toBe(port);
    } finally {
      await release();
    }
  });
});
