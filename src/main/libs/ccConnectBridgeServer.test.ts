import { afterEach, expect, test, vi } from 'vitest';

import { CcConnectBridgeServer } from './ccConnectBridgeServer';
import { createCcConnectProtocolHeaders } from '../../shared/ccConnect/protocol';

const servers: CcConnectBridgeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.stop()));
});

test('accepts only an authenticated normalized channel turn', async () => {
  const server = new CcConnectBridgeServer('secret', {
    onTurn: async request => ({
      content: `reply:${request.message.content}`,
    }),
    onCronTrigger: async () => undefined,
  });
  servers.push(server);
  const url = await server.start();
  const body = {
    requestId: 'request-1',
    accountId: 'default',
    message: {
      sessionKey: 'telegram:chat',
      platform: 'telegram',
      messageId: '1',
      channelId: 'chat',
      userId: 'user',
      chatType: 'direct',
      content: 'hello',
    },
  };
  const unauthorized = await fetch(`${url}/v1/cc-connect/turn`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  expect(unauthorized.status).toBe(401);
  const accepted = await fetch(`${url}/v1/cc-connect/turn`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret',
      'content-type': 'application/json',
      ...createCcConnectProtocolHeaders('request-1'),
    },
    body: JSON.stringify(body),
  });
  expect(accepted.status).toBe(200);
  await expect(accepted.json()).resolves.toEqual({ content: 'reply:hello' });
});

test('requires a complete cron trigger identity', async () => {
  const seen: string[] = [];
  const server = new CcConnectBridgeServer('secret', {
    onTurn: async () => ({ content: 'unused' }),
    onCronTrigger: async trigger => void seen.push(trigger.taskId),
  });
  servers.push(server);
  const url = await server.start();
  const invalid = await fetch(`${url}/v1/cc-connect/cron/trigger`, {
    method: 'POST',
    headers: { authorization: 'Bearer secret', ...createCcConnectProtocolHeaders('invalid') },
    body: JSON.stringify({ taskId: 'task' }),
  });
  expect(invalid.status).toBe(400);
  const accepted = await fetch(`${url}/v1/cc-connect/cron/trigger`, {
    method: 'POST',
    headers: { authorization: 'Bearer secret', ...createCcConnectProtocolHeaders('accepted') },
    body: JSON.stringify({
      requestId: 'r',
      accountId: 'p',
      taskId: 'task',
      scheduleVersion: 'v1',
      scheduledAt: new Date().toISOString(),
    }),
  });
  expect(accepted.status).toBe(204);
  expect(seen).toEqual(['task']);
});

test('aborts the active turn when the sidecar disconnects', async () => {
  let observedSignal: AbortSignal | null = null;
  const server = new CcConnectBridgeServer('secret', {
    onTurn: async (_request, signal) => {
      observedSignal = signal;
      await new Promise<void>(resolve =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
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
        chatType: 'direct',
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
        chatType: 'group',
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
        chatType: 'direct',
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
    requestId: 'replay',
    accountId: 'p',
    taskId: 't',
    scheduleVersion: 'v1',
    scheduledAt: new Date().toISOString(),
  });
  expect(
    (await fetch(`${url}/v1/cc-connect/cron/trigger`, { method: 'POST', headers, body })).status,
  ).toBe(204);
  expect(
    (await fetch(`${url}/v1/cc-connect/cron/trigger`, { method: 'POST', headers, body })).status,
  ).toBe(401);
});

test('accepts media-only turns and attachment-only replies', async () => {
  const server = new CcConnectBridgeServer('secret', {
    onTurn: async request => ({
      content: '',
      attachments: [{ kind: 'image', path: `C:\\${request.message.images?.[0].FileName}` }],
    }),
    onCronTrigger: async () => undefined,
  });
  servers.push(server);
  const url = await server.start();
  const response = await fetch(`${url}/v1/cc-connect/turn`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret',
      'content-type': 'application/json',
      ...createCcConnectProtocolHeaders('media-only'),
    },
    body: JSON.stringify({
      requestId: 'media-only',
      accountId: 'account',
      message: {
        sessionKey: 'telegram:chat',
        platform: 'telegram',
        messageId: 'message',
        userId: 'user',
        chatType: 'direct',
        content: '',
        images: [{ MimeType: 'image/png', Data: 'aW1hZ2U=', FileName: 'image.png' }],
      },
    }),
  });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    content: '',
    attachments: [{ kind: 'image' }],
  });
});

test('accepts a quoted-context-only turn', async () => {
  const server = new CcConnectBridgeServer('secret', {
    onTurn: async request => ({ content: request.message.extraContent ?? '' }),
    onCronTrigger: async () => undefined,
  });
  servers.push(server);
  const url = await server.start();
  const response = await fetch(`${url}/v1/cc-connect/turn`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret',
      'content-type': 'application/json',
      ...createCcConnectProtocolHeaders('quoted-context'),
    },
    body: JSON.stringify({
      requestId: 'quoted-context',
      accountId: 'account',
      message: {
        sessionKey: 'feishu:chat',
        platform: 'feishu',
        messageId: 'message',
        userId: 'user',
        chatType: 'group',
        content: '',
        extraContent: '> quoted message',
      },
    }),
  });
  expect(response.status).toBe(200);
});

test('accepts a text turn with null media fields from the Go sidecar', async () => {
  let normalized: { images?: unknown; files?: unknown; audio?: unknown } | null = null;
  const server = new CcConnectBridgeServer('secret', {
    onTurn: async request => {
      normalized = {
        images: request.message.images,
        files: request.message.files,
        audio: request.message.audio,
      };
      return { content: `reply:${request.message.content}` };
    },
    onCronTrigger: async () => undefined,
  });
  servers.push(server);
  const url = await server.start();
  // The Go sidecar marshals its turn message from a map, so absent media
  // arrives as explicit null rather than omitted keys.
  const response = await fetch(`${url}/v1/cc-connect/turn`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret',
      'content-type': 'application/json',
      ...createCcConnectProtocolHeaders('null-media'),
    },
    body: JSON.stringify({
      requestId: 'null-media',
      accountId: 'weixin-account',
      message: {
        sessionKey: 'weixin:dm:user',
        platform: 'weixin',
        messageId: 'message',
        userId: 'user',
        chatType: 'direct',
        content: 'hello',
        images: null,
        files: null,
        audio: null,
        userMessageTimeMs: 0,
      },
    }),
  });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ content: 'reply:hello' });
  // The nulls are normalized before the handler runs, so downstream code
  // never observes them.
  expect(normalized).toEqual({ images: undefined, files: undefined, audio: undefined });
});

test('still rejects malformed media payloads', async () => {
  const server = new CcConnectBridgeServer('secret', {
    onTurn: async () => ({ content: 'unused' }),
    onCronTrigger: async () => undefined,
  });
  servers.push(server);
  const url = await server.start();
  for (const malformed of [
    { images: 'not-an-array' },
    { files: [123] },
    { audio: { MimeType: 'audio/amr' } },
  ]) {
    const response = await fetch(`${url}/v1/cc-connect/turn`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
        ...createCcConnectProtocolHeaders('malformed-media'),
      },
      body: JSON.stringify({
        requestId: 'malformed-media',
        accountId: 'account',
        message: {
          sessionKey: 'weixin:dm:user',
          platform: 'weixin',
          messageId: 'message',
          userId: 'user',
          chatType: 'direct',
          content: 'hello',
          ...malformed,
        },
      }),
    });
    expect(response.status).toBe(400);
  }
});
