import { afterEach, expect, test, vi } from "vitest";

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
    accountId: "default",
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
      accountId: "p",
      taskId: "task",
      scheduleVersion: "v1",
      scheduledAt: new Date().toISOString(),
    }),
  });
  expect(accepted.status).toBe(204);
  expect(seen).toEqual(["task"]);
});

test('aborts the active turn when the sidecar disconnects', async () => {
  let observedSignal: AbortSignal | null = null;
  const server = new CcConnectBridgeServer('secret', {
    onTurn: async (_request, signal) => {
      observedSignal = signal;
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      throw new Error('cancelled');
    },
    onCronTrigger: async () => undefined,
  });
  servers.push(server);
  const url = await server.start();
  const controller = new AbortController();
  const request = fetch(`${url}/v1/cc-connect/turn`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      authorization: 'Bearer secret',
      'content-type': 'application/json',
      ...createCcConnectProtocolHeaders('disconnect'),
    },
    body: JSON.stringify({
      requestId: 'disconnect',
      accountId: 'weixin-account',
      message: {
        sessionKey: 'weixin:dm:user',
        platform: 'weixin',
        messageId: 'message',
        userId: 'user',
        content: 'hello',
      },
    }),
  });
  await vi.waitFor(() => expect(observedSignal).not.toBeNull());
  controller.abort();

  await expect(request).rejects.toThrow();
  await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));
});

test('accepts a turn when the platform only supplies a session key', async () => {
  const server = new CcConnectBridgeServer('secret', {
    onTurn: async request => ({ content: request.message.sessionKey }),
    onCronTrigger: async () => undefined,
  });
  servers.push(server);
  const url = await server.start();
  const response = await fetch(`${url}/v1/cc-connect/turn`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret',
      'content-type': 'application/json',
      ...createCcConnectProtocolHeaders('session-key-only'),
    },
    body: JSON.stringify({
      requestId: 'session-key-only',
      accountId: 'dingtalk-account',
      message: {
        sessionKey: 'dingtalk:g:conversation:user',
        platform: 'dingtalk',
        messageId: 'message',
        userId: 'user',
        content: 'hello',
      },
    }),
  });
  expect(response.status).toBe(200);
});

test('rejects the retired project identity field', async () => {
  const server = new CcConnectBridgeServer('secret', {
    onTurn: async () => ({ content: 'unused' }),
    onCronTrigger: async () => undefined,
  });
  servers.push(server);
  const url = await server.start();
  const response = await fetch(`${url}/v1/cc-connect/turn`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret',
      'content-type': 'application/json',
      ...createCcConnectProtocolHeaders('retired-project-field'),
    },
    body: JSON.stringify({
      requestId: 'retired-project-field',
      project: 'retired',
      message: {
        sessionKey: 'telegram:chat',
        platform: 'telegram',
        messageId: 'message',
        userId: 'user',
        content: 'hello',
      },
    }),
  });
  expect(response.status).toBe(400);
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
    requestId: 'replay', accountId: 'p', taskId: 't', scheduleVersion: 'v1', scheduledAt: new Date().toISOString(),
  });
  expect((await fetch(`${url}/v1/cc-connect/cron/trigger`, { method: 'POST', headers, body })).status).toBe(204);
  expect((await fetch(`${url}/v1/cc-connect/cron/trigger`, { method: 'POST', headers, body })).status).toBe(401);
});
