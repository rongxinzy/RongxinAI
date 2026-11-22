import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';
import { expect, test, vi } from 'vitest';

import { createTestMagpie } from '../../../tests/helpers/createTestMagpie';
import {
  CcConnectPiBridge,
  getCcConnectScopedConversationId,
  normalizeCcConnectPlatform,
  parseCcConnectScopedConversationId,
} from './ccConnectPiBridge';
import { ChannelInboxStore } from './channelInboxStore';
import { ChannelTurnCoordinator } from './channelTurnCoordinator';
import { IMStore } from './imStore';
import { initializeIMSchema } from './schema';
import { ActivityService } from '../activity/activityService';
import { initializeActivitySchema } from '../activity/schema';
import { CoworkStore } from '../coworkStore';
import { PiRuntimeAdapter } from '../libs/agentEngine';
import { CcConnectBridgeServer } from '../libs/ccConnectBridgeServer';
import { SqliteStore } from '../sqliteStore';
import { createCcConnectProtocolHeaders } from '../../shared/ccConnect/protocol';
import { CcConnectDeliveryTransport } from '../../scheduledTask/ccConnectDeliveryTransport';
import { DeliveryMode } from '../../scheduledTask/constants';
import type { ScheduledTask } from '../../scheduledTask/types';

const mockApp = app as unknown as Record<string, unknown>;
if (typeof mockApp.getAppPath !== 'function') mockApp.getAppPath = () => process.cwd();

test('normalizes Lark transport events to the Feishu product channel', () => {
  expect(normalizeCcConnectPlatform('lark')).toBe('feishu');
  expect(normalizeCcConnectPlatform('feishu')).toBe('feishu');
  expect(normalizeCcConnectPlatform('qqbot')).toBe('qq');
  expect(normalizeCcConnectPlatform('unknown')).toBeNull();
});

test('separates the same platform conversation for distinct ChannelAccounts', () => {
  const first = getCcConnectScopedConversationId('telegram-primary', 'chat-1');
  const second = getCcConnectScopedConversationId('telegram-secondary', 'chat-1');
  expect(first).not.toBe(second);
  expect(first).toMatch(/^cc-connect:[A-Za-z0-9_-]+$/);
});

test('recovers only a valid scoped account and native conversation pair', () => {
  const scoped = getCcConnectScopedConversationId('telegram-primary', 'chat-1');
  expect(parseCcConnectScopedConversationId(scoped)).toEqual(['telegram-primary', 'chat-1']);
  expect(() => parseCcConnectScopedConversationId('group:chat-1')).toThrow('invalid');
  expect(() => parseCcConnectScopedConversationId('cc-connect:e30')).toThrow('invalid');
});

test('rejects missing bridge account or conversation identity', () => {
  expect(() => getCcConnectScopedConversationId('', 'chat-1')).toThrow('required');
  expect(() => getCcConnectScopedConversationId('account', '  ')).toThrow('required');
});

test('replays a committed reply without changing the current delivery route or running Pi', async () => {
  const db = new Database(':memory:');
  initializeIMSchema(db);
  const inbox = new ChannelInboxStore(db);
  initializeActivitySchema(db);
  const imStore = new IMStore(db);
  const workspaceLookup = vi.spyOn(imStore, 'getChannelAccountWorkspaceId');
  const runtime = new PiRuntimeAdapter();
  const listenersBefore = runtime.listenerCount('messageUpdate');
  const registerInterest = vi.spyOn(runtime, 'registerStreamingTextInterestResolver');
  const startTurn = vi.spyOn(runtime, 'startSession');
  const continueTurn = vi.spyOn(runtime, 'continueSession');
  const bridge = new CcConnectPiBridge({
    runtime,
    coworkStore: new CoworkStore(db),
    imStore,
    getSkillsPrompt: async () => null,
    turnCoordinator: new ChannelTurnCoordinator(inbox),
    activityService: new ActivityService(db),
  });
  const server = new CcConnectBridgeServer('fixture-secret', {
    onTurn: (request, signal) => bridge.runTurn(request, signal),
  });
  expect(runtime.listenerCount('messageUpdate')).toBe(listenersBefore);
  try {
    imStore.setCcConnectSessionKey('bot', 'qq', 'chat', 'qqbot:chat:newer-key');
    inbox.complete(
      { platform: 'qqbot', accountId: 'bot', conversationId: 'chat', messageId: '1' },
      'saved reply',
    );
    const url = await server.start();
    const response = await fetch(`${url}/v1/cc-connect/turn`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer fixture-secret',
        'content-type': 'application/json',
        ...createCcConnectProtocolHeaders('redelivery'),
      },
      body: JSON.stringify({
        requestId: 'redelivery',
        accountId: 'bot',
        message: {
          sessionKey: 'qqbot:chat:older-key',
          platform: 'qqbot',
          channelId: 'chat',
          messageId: '1',
          userId: 'user',
          chatType: 'direct',
          content: 'A redelivered request',
        },
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ content: 'saved reply' });
    expect(workspaceLookup).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
    expect(continueTurn).not.toHaveBeenCalled();

    const send = vi.fn(async () => undefined);
    const delivery = new CcConnectDeliveryTransport(imStore);
    delivery.connect(['bot'], { send });
    await delivery.send({
      task: {
        delivery: { mode: DeliveryMode.Announce, channel: 'qq', accountId: 'bot', to: 'chat' },
      } as ScheduledTask,
      run: {} as never,
      content: 'scheduled result',
    });
    expect(send).toHaveBeenCalledExactlyOnceWith(
      {
        accountId: 'bot',
        platform: 'qqbot',
        sessionKey: 'qqbot:chat:newer-key',
        content: 'scheduled result',
      },
      undefined,
    );
  } finally {
    await server.stop();
    bridge.dispose();
    runtime.stopAllSessions();
    db.close();
  }
  expect(runtime.listenerCount('messageUpdate')).toBe(listenersBefore);
  expect(registerInterest).not.toHaveBeenCalled();
});

test('reuses a Channel Pi transcript after the embedded runtime restarts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'zhiyuan-channel-pi-'));
  const requests: string[] = [];
  const upstream = createServer(async (req, res) => {
    requests.push(Buffer.concat(await Array.fromAsync(req)).toString('utf8'));
    const chunk = (delta: unknown, finishReason: string | null) =>
      `data: ${JSON.stringify({ id: 'channel', object: 'chat.completion.chunk', model: 'channel-fixture', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(
      chunk({ role: 'assistant', content: `Channel answer ${requests.length}.` }, null) +
        chunk({}, 'stop') +
        'data: [DONE]\n\n',
    );
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const gateway = createTestMagpie({
    gatewayUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    defaultModelId: 'channel-fixture',
  });
  const sqlite = await SqliteStore.create(directory);
  const db = sqlite.getDatabase();
  const coworkStore = new CoworkStore(db);
  const imStore = new IMStore(db);
  const workspace = coworkStore.workspaces.ensureWorkspace(directory);
  vi.spyOn(imStore, 'getChannelAccountWorkspaceId').mockReturnValue(workspace.id);
  const openChannel = () => {
    const runtime = new PiRuntimeAdapter({
      modelService: gateway.modelService,
      coworkStore,
      piSessionStoreRoot: directory,
    });
    const bridge = new CcConnectPiBridge({
      runtime,
      coworkStore,
      imStore,
      getSkillsPrompt: async () => null,
      turnCoordinator: new ChannelTurnCoordinator(new ChannelInboxStore(db)),
      activityService: new ActivityService(db),
    });
    return {
      run: (messageId: string) =>
        bridge.runTurn(
          {
            requestId: messageId,
            accountId: 'bot',
            message: {
              sessionKey: 'qqbot:chat:fixture',
              platform: 'qqbot',
              channelId: 'chat',
              messageId,
              userId: 'user',
              chatType: 'direct',
              content: `Channel input ${messageId}.`,
            },
          },
          AbortSignal.timeout(5000),
        ),
      close: () => {
        bridge.dispose();
        runtime.stopAllSessions();
      },
    };
  };
  let channel = openChannel();
  try {
    await expect(channel.run('1')).resolves.toEqual({ content: 'Channel answer 1.' });
    await expect(channel.run('2')).resolves.toEqual({ content: 'Channel answer 2.' });
    channel.close();
    channel = openChannel();
    await expect(channel.run('3')).resolves.toEqual({ content: 'Channel answer 3.' });
    expect(requests).toHaveLength(3);
    expect(requests[1]).toContain('Channel answer 1.');
    expect(requests[2]).toContain('Channel answer 1.');
    expect(requests[2]).toContain('Channel answer 2.');
    expect(imStore.listSessionMappings()).toHaveLength(1);
  } finally {
    channel.close();
    sqlite.close();
    await new Promise<void>(resolve => {
      upstream.close(() => resolve());
      upstream.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  }
});
