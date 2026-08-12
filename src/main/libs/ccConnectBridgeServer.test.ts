import { afterEach, expect, test } from "vitest";

import { CcConnectBridgeServer } from "./ccConnectBridgeServer";
import { createCcConnectProtocolHeaders } from '../../shared/ccConnect/protocol';

const servers: CcConnectBridgeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

test("accepts only an authenticated normalized channel turn", async () => {
  const server = new CcConnectBridgeServer("secret", {
    onTurn: async (request) => ({
      content: `reply:${request.message.content}`,
    }),
    onCronTrigger: async () => undefined,
  });
  servers.push(server);
  const url = await server.start();
  const body = {
    requestId: "request-1",
    project: "default",
    message: {
      sessionKey: "telegram:chat",
      platform: "telegram",
      messageId: "1",
      channelId: "chat",
      userId: "user",
      content: "hello",
    },
  };
  const unauthorized = await fetch(`${url}/v1/cc-connect/turn`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  expect(unauthorized.status).toBe(401);
  const accepted = await fetch(`${url}/v1/cc-connect/turn`, {
    method: "POST",
    headers: {
      authorization: "Bearer secret",
      "content-type": "application/json",
      ...createCcConnectProtocolHeaders('request-1'),
    },
    body: JSON.stringify(body),
  });
  expect(accepted.status).toBe(200);
  await expect(accepted.json()).resolves.toEqual({ content: "reply:hello" });
});

test("requires a complete cron trigger identity", async () => {
  const seen: string[] = [];
  const server = new CcConnectBridgeServer("secret", {
    onTurn: async () => ({ content: "unused" }),
    onCronTrigger: async (trigger) => void seen.push(trigger.taskId),
  });
  servers.push(server);
  const url = await server.start();
  const invalid = await fetch(`${url}/v1/cc-connect/cron/trigger`, {
    method: "POST",
    headers: { authorization: "Bearer secret", ...createCcConnectProtocolHeaders('invalid') },
    body: JSON.stringify({ taskId: "task" }),
  });
  expect(invalid.status).toBe(400);
  const accepted = await fetch(`${url}/v1/cc-connect/cron/trigger`, {
    method: "POST",
    headers: { authorization: "Bearer secret", ...createCcConnectProtocolHeaders('accepted') },
    body: JSON.stringify({
      requestId: "r",
      project: "p",
      taskId: "task",
      scheduleVersion: "v1",
      scheduledAt: new Date().toISOString(),
    }),
  });
  expect(accepted.status).toBe(204);
  expect(seen).toEqual(["task"]);
});

test('rejects replayed protocol nonces', async () => {
  const server = new CcConnectBridgeServer('secret', {
    onTurn: async () => ({ content: 'ok' }),
    onCronTrigger: async () => undefined,
  });
  servers.push(server);
  const url = await server.start();
  const headers = { authorization: 'Bearer secret', ...createCcConnectProtocolHeaders('replay') };
  const body = JSON.stringify({
    requestId: 'replay', project: 'p', taskId: 't', scheduleVersion: 'v1', scheduledAt: new Date().toISOString(),
  });
  expect((await fetch(`${url}/v1/cc-connect/cron/trigger`, { method: 'POST', headers, body })).status).toBe(204);
  expect((await fetch(`${url}/v1/cc-connect/cron/trigger`, { method: 'POST', headers, body })).status).toBe(401);
});
