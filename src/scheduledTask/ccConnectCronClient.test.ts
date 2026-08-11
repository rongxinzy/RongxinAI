import http from 'node:http';
import { afterEach, expect, test } from 'vitest';
import { CcConnectCronClient } from './ccConnectCronClient';

const servers: http.Server[] = [];
afterEach(async () => Promise.all(servers.splice(0).map(s => new Promise<void>(r => s.close(() => r())))));

test('sends only authenticated trigger registration', async () => {
  const server = http.createServer((req, res) => {
    expect(req.headers.authorization).toBe('Bearer secret');
    expect(req.url).toBe('/v1/cc-connect/cron/tasks');
    res.writeHead(204).end();
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new CcConnectCronClient(`http://127.0.0.1:${port}`, 'secret').upsert({ taskId: 't', scheduleVersion: 'v1', expression: '* * * * *' });
});
