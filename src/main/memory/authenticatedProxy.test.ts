import http from 'http';
import { afterEach, expect, test } from 'vitest';

import { createAuthenticatedEngramProxy, isAllowedEngramRequest } from './authenticatedProxy';

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map(close => close()));
});

test('requires the launch token before forwarding an allowed request', async () => {
  const backend = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
  });
  await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve));
  closeCallbacks.push(() => new Promise(resolve => backend.close(() => resolve())));
  const address = backend.address();
  if (!address || typeof address === 'string') throw new Error('Backend did not bind.');
  const proxy = await createAuthenticatedEngramProxy({
    backendPort: address.port,
    token: 'secret',
  });
  closeCallbacks.push(proxy.close);

  const unauthorized = await fetch(`${proxy.url}/health`);
  const authorized = await fetch(`${proxy.url}/health`, {
    headers: { Authorization: 'Bearer secret' },
  });

  expect(unauthorized.status).toBe(401);
  expect(authorized.status).toBe(200);
  await expect(authorized.json()).resolves.toEqual({ status: 'ok' });
});

test('blocks routes outside the product memory capability boundary', async () => {
  const backend = http.createServer((_request, response) => response.end('unexpected'));
  await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve));
  closeCallbacks.push(() => new Promise(resolve => backend.close(() => resolve())));
  const address = backend.address();
  if (!address || typeof address === 'string') throw new Error('Backend did not bind.');
  const proxy = await createAuthenticatedEngramProxy({
    backendPort: address.port,
    token: 'secret',
  });
  closeCallbacks.push(proxy.close);

  const response = await fetch(`${proxy.url}/export`, {
    headers: { Authorization: 'Bearer secret' },
  });

  expect(response.status).toBe(404);
  expect(isAllowedEngramRequest('GET', '/search')).toBe(true);
  expect(isAllowedEngramRequest('GET', '/observations/recent')).toBe(true);
  expect(isAllowedEngramRequest('POST', '/conflicts/judge')).toBe(false);
});
