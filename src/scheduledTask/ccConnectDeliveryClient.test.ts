import http from 'node:http';
import { afterEach, expect, test } from 'vitest';

import { CcConnectDeliveryClient } from './ccConnectDeliveryClient';

const servers: http.Server[] = [];
afterEach(async () => Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))));

test('sends only authenticated resolved delivery data to the sidecar', async () => {
  let body = '';
  const server = http.createServer((request, response) => {
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/v1/cc-connect/deliver');
    expect(request.headers.authorization).toBe('Bearer secret');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => response.writeHead(204).end());
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new CcConnectDeliveryClient(`http://127.0.0.1:${port}`, 'secret')
    .send({ platform: 'telegram', sessionKey: 'telegram:42', content: 'done' });
  expect(JSON.parse(body)).toEqual({ platform: 'telegram', sessionKey: 'telegram:42', content: 'done' });
});
