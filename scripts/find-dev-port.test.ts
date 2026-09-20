import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'vitest';

import {
  DEFAULT_DEV_PORT,
  findAvailablePort,
  isPortAvailable,
} from '../scripts/find-dev-port.mjs';

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}

test('findAvailablePort starts at the preferred port when free', async () => {
  const port = await findAvailablePort(DEFAULT_DEV_PORT, 5);
  assert.equal(typeof port, 'number');
  assert.ok(port >= DEFAULT_DEV_PORT);
  assert.equal(await isPortAvailable(port), true);
});

test('findAvailablePort skips occupied ports', async () => {
  const occupied = await listen(0);
  const address = occupied.address();
  assert.ok(address && typeof address === 'object');
  const busyPort = address.port;

  try {
    const next = await findAvailablePort(busyPort, 10);
    assert.ok(next > busyPort);
    assert.notEqual(next, busyPort);
  } finally {
    await close(occupied);
  }
});
