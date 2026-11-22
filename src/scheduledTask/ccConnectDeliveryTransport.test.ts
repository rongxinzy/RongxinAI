import { expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';

import { getCcConnectScopedConversationId } from '../main/im/ccConnectConversationId';
import { IMStore } from '../main/im/imStore';
import { initializeIMSchema } from '../main/im/schema';
import { DeliveryMode, PayloadKind, ScheduleKind, SessionTarget, WakeMode } from './constants';
import { CcConnectDeliveryTransport } from './ccConnectDeliveryTransport';
import type { ScheduledTask, ScheduledTaskRun } from './types';

const task = {
  delivery: {
    mode: DeliveryMode.Announce,
    channel: 'qq',
    accountId: 'account',
    to: 'conversation',
  },
  payload: { kind: PayloadKind.AgentTurn, message: 'run' },
  schedule: { kind: ScheduleKind.Every, everyMs: 60_000 },
  sessionTarget: SessionTarget.Isolated,
  wakeMode: WakeMode.NextHeartbeat,
} as unknown as ScheduledTask;

test('uses the sidecar-native session key instead of the display destination', async () => {
  const getCcConnectSessionKey = vi.fn(() => 'qqbot:group:opaque');
  const send = vi.fn(async () => undefined);
  const transport = new CcConnectDeliveryTransport({
    getCcConnectSessionKey,
    getCcConnectCoworkSessionId: () => null,
  });
  transport.connect(['account'], { send });
  await transport.send({ task, run: {} as never, content: 'completed' });
  expect(getCcConnectSessionKey).toHaveBeenCalledWith('account', 'qqbot', 'conversation');
  expect(send).toHaveBeenCalledWith(
    {
      accountId: 'account',
      platform: 'qqbot',
      sessionKey: 'qqbot:group:opaque',
      content: 'completed',
    },
    undefined,
  );
});

test('delivery waits for Channel startup and an interrupted delivery does not send', async () => {
  const transport = new CcConnectDeliveryTransport({
    getCcConnectSessionKey: () => 'qqbot:group:opaque',
    getCcConnectCoworkSessionId: () => null,
  });
  const starting = Promise.withResolvers<void>();
  const startup = transport.trackStartup(starting.promise);
  const abort = new AbortController();
  const input = { task, run: {} as ScheduledTaskRun, content: 'completed' };
  const cancelled = expect(transport.send(input, abort.signal)).rejects.toThrow('cancelled');
  abort.abort(new Error('cancelled'));
  await cancelled;

  const sent = vi.fn();
  const waiting = transport.send(input).then(sent);
  await Promise.resolve();
  expect(sent).not.toHaveBeenCalled();
  const send = vi.fn(async () => undefined);
  transport.connect(['account'], { send });
  starting.resolve();
  await Promise.all([startup, waiting]);
  expect(send).toHaveBeenCalledOnce();
  expect(sent).toHaveBeenCalledOnce();
});

test.each([
  ['recipient-session', 0],
  ['separate-session', 1],
  [null, 1],
] as const)(
  'keeps exactly one recipient transcript projection for run session %s',
  async (sessionId, extraWrites) => {
    const addMessage = vi.fn();
    const send = vi.fn(async () => undefined);
    const transport = new CcConnectDeliveryTransport(
      {
        getCcConnectSessionKey: () => 'qqbot:conversation:opaque',
        getCcConnectCoworkSessionId: () => 'recipient-session',
      },
      { addMessage },
    );
    transport.connect(['account'], { send });
    await transport.send({ task, run: { sessionId } as ScheduledTaskRun, content: 'completed' });
    expect(send).toHaveBeenCalledOnce();
    expect(addMessage).toHaveBeenCalledTimes(extraWrites);
    if (extraWrites)
      expect(addMessage).toHaveBeenCalledWith(
        'recipient-session',
        expect.objectContaining({ type: 'assistant', content: 'completed' }),
      );
  },
);

test('refuses to guess a route or account', async () => {
  const transport = new CcConnectDeliveryTransport({
    getCcConnectSessionKey: () => null,
    getCcConnectCoworkSessionId: () => null,
  });
  await expect(transport.send({ task, run: {} as never, content: 'completed' })).rejects.toThrow(
    'unavailable',
  );
});

test('recovers the account for a legacy delivery without accountId', async () => {
  const getCcConnectSessionKey = vi.fn(() => 'weixin:dm:user');
  const send = vi.fn(async () => undefined);
  const transport = new CcConnectDeliveryTransport({
    getCcConnectSessionKey,
    getCcConnectCoworkSessionId: (account, platform, conversation) =>
      account === '54a91b8e90eb@im.bot' && platform === 'weixin' && conversation === 'dm'
        ? 'mapped'
        : null,
  });
  transport.connect(['54a91b8e90eb@im.bot'], { send });
  await transport.send({
    task: {
      ...task,
      delivery: { mode: DeliveryMode.Announce, channel: 'weixin', to: 'dm' },
    } as unknown as ScheduledTask,
    run: {} as never,
    content: 'completed',
  });
  expect(send).toHaveBeenCalledWith(
    {
      accountId: '54a91b8e90eb@im.bot',
      platform: 'weixin',
      sessionKey: 'weixin:dm:user',
      content: 'completed',
    },
    undefined,
  );
});

test('a new sidecar replaces all routes and disconnect removes them together', async () => {
  const first = vi.fn(async () => undefined);
  const second = vi.fn(async () => undefined);
  const transport = new CcConnectDeliveryTransport({
    getCcConnectSessionKey: (_account, _platform, conversation) => 'qqbot:' + conversation,
    getCcConnectCoworkSessionId: () => null,
  });
  const send = (accountId: string) =>
    transport.send({
      task: { ...task, delivery: { ...task.delivery, accountId } },
      run: {} as never,
      content: 'done',
    });
  transport.connect(['account', 'retired'], { send: first });
  await send('retired');
  transport.connect(['account'], { send: second });
  await expect(send('retired')).rejects.toThrow('unavailable');
  await send('account');
  transport.disconnect();
  await expect(send('account')).rejects.toThrow('unavailable');
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
});

test.each(['account', undefined])(
  'records the reply in the session selected at dispatch (%s)',
  async accountId => {
    const db = new Database(':memory:');
    try {
      initializeIMSchema(db);
      const imStore = new IMStore(db);
      const conversation = getCcConnectScopedConversationId('account', 'conversation');
      imStore.setCcConnectSessionKey('account', 'qq', 'conversation', 'qqbot:original');
      imStore.createSessionMapping(conversation, 'qq', 'original-session');
      const ack = Promise.withResolvers<void>();
      const send = vi.fn(() => ack.promise);
      const addMessage = vi.fn();
      const transport = new CcConnectDeliveryTransport(imStore, { addMessage });
      transport.connect(['account', 'unrelated'], { send });

      const delivery = transport.send({
        task: { ...task, delivery: { ...task.delivery, accountId } },
        run: { sessionId: 'execution-session' } as ScheduledTaskRun,
        content: 'completed',
      });
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ sessionKey: 'qqbot:original' }),
        undefined,
      );
      imStore.deleteSessionMapping(conversation, 'qq');
      imStore.createSessionMapping(conversation, 'qq', 'new-session');
      ack.resolve();
      await delivery;

      expect(addMessage).toHaveBeenCalledExactlyOnceWith(
        'original-session',
        expect.objectContaining({ content: 'completed' }),
      );
    } finally {
      db.close();
    }
  },
);
