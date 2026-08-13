import http from 'node:http';
import { afterEach, expect, test } from 'vitest';
import { CcConnectCronClient } from './ccConnectCronClient';
import { ScheduleKind } from './constants';
import { CcConnectProtocol } from '../shared/ccConnect/constants';

const servers: http.Server[] = [];
afterEach(async () =>
  Promise.all(servers.splice(0).map(s => new Promise<void>(r => s.close(() => r())))),
);

test('sends only authenticated trigger registration without a task payload', async () => {
  let body = '';
  const server = http.createServer((req, res) => {
    expect(req.headers.authorization).toBe('Bearer secret');
    expect(req.headers[CcConnectProtocol.Header.Version]).toBe(CcConnectProtocol.Version);
    expect(req.headers[CcConnectProtocol.Header.Nonce]).toBeTruthy();
    expect(req.url).toBe('/v1/cc-connect/cron/tasks');
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => res.writeHead(204).end());
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new CcConnectCronClient(`http://127.0.0.1:${port}`, 'secret').upsert({
    accountId: 'account-a',
    taskId: 't',
    scheduleVersion: 'v1',
    schedule: { kind: ScheduleKind.Every, everyMs: 60_000 },
  });
  expect(JSON.parse(body)).toEqual({
    accountId: 'account-a',
    taskId: 't',
    scheduleVersion: 'v1',
    schedule: { kind: 'every', everyMs: 60_000 },
  });
});

test('routes task removal by account id', async () => {
  let requestUrl = '';
  const server = http.createServer((req, res) => {
    requestUrl = req.url ?? '';
    res.writeHead(204).end();
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new CcConnectCronClient(`http://127.0.0.1:${port}`, 'secret').remove({
    accountId: 'scheduler account',
    taskId: 'task/a',
  });
  expect(requestUrl).toBe('/v1/cc-connect/cron/tasks/task%2Fa?accountId=scheduler+account');
});

test('checks the authenticated sidecar control-plane health route', async () => {
  const server = http.createServer((req, res) => {
    expect(req.url).toBe('/v1/cc-connect/cron/health');
    expect(req.headers.authorization).toBe('Bearer secret');
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        protocolVersion: CcConnectProtocol.Version,
        pid: 42,
        parentPid: process.pid,
        capabilities: [
          CcConnectProtocol.Capability.TriggerOnlyCron,
          CcConnectProtocol.Capability.ChannelPolicy,
          CcConnectProtocol.Capability.MediaReply,
          CcConnectProtocol.Capability.RuntimeActivity,
        ],
        platforms: [],
      }),
    );
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await expect(
    new CcConnectCronClient(`http://127.0.0.1:${port}`, 'secret').healthCheck(42),
  ).resolves.toMatchObject({ pid: 42 });
});
