import { expect, test, vi } from "vitest";

import {
  DeliveryMode,
  PayloadKind,
  ScheduleKind,
  SessionTarget,
  WakeMode,
} from "./constants";
import { CcConnectDeliveryTransport } from "./ccConnectDeliveryTransport";
import type { ScheduledTask } from "./types";

const task = {
  delivery: {
    mode: DeliveryMode.Announce,
    channel: "qq",
    accountId: "account",
    to: "conversation",
  },
  payload: { kind: PayloadKind.AgentTurn, message: "run" },
  schedule: { kind: ScheduleKind.Every, everyMs: 60_000 },
  sessionTarget: SessionTarget.Isolated,
  wakeMode: WakeMode.NextHeartbeat,
} as unknown as ScheduledTask;

test("uses the sidecar-native session key instead of the display destination", async () => {
  const getCcConnectSessionKey = vi.fn(() => "qqbot:group:opaque");
  const send = vi.fn(async () => undefined);
  const transport = new CcConnectDeliveryTransport({
    getCcConnectSessionKey,
    listSessionMappings: () => [],
  });
  transport.attach("account", { send });
  await transport.send({ task, run: {} as never, content: "completed", truncated: false });
  expect(getCcConnectSessionKey).toHaveBeenCalledWith(
    "account",
    "qqbot",
    "conversation",
  );
  expect(send).toHaveBeenCalledWith({
    accountId: "account",
    platform: "qqbot",
    sessionKey: "qqbot:group:opaque",
    content: "completed",
  });
});

test("refuses to guess a route or account", async () => {
  const transport = new CcConnectDeliveryTransport({
    getCcConnectSessionKey: () => null,
    listSessionMappings: () => [],
  });
  await expect(
    transport.send({ task, run: {} as never, content: "completed", truncated: false }),
  ).rejects.toThrow("unavailable");
});

test('recovers the account for a legacy delivery without accountId', async () => {
  const getCcConnectSessionKey = vi.fn(() => 'weixin:dm:user');
  const send = vi.fn(async () => undefined);
  const transport = new CcConnectDeliveryTransport({
    getCcConnectSessionKey,
    listSessionMappings: () => [
      {
        imConversationId: 'cc-connect:WyI1NGE5MWI4ZTkwZWJAaW0uYm90IiwiZG0iXQ',
        platform: 'weixin',
      } as never,
    ],
  });
  transport.attach('54a91b8e90eb@im.bot', { send });
  await transport.send({
    task: {
      ...task,
      delivery: { mode: DeliveryMode.Announce, channel: 'weixin', to: 'dm' },
    } as unknown as ScheduledTask,
    run: {} as never,
    content: 'completed',
  });
  expect(send).toHaveBeenCalledWith({
    accountId: '54a91b8e90eb@im.bot',
    platform: 'weixin',
    sessionKey: 'weixin:dm:user',
    content: 'completed',
  });
});

test('persists the write-back with the delivery source marker and truncation flag', async () => {
  const send = vi.fn(async () => undefined);
  const addMessage = vi.fn();
  const conversationId = JSON.stringify(['account', 'conversation']);
  const transport = new CcConnectDeliveryTransport(
    {
      getCcConnectSessionKey: () => 'qqbot:group:opaque',
      listSessionMappings: () => [
        { imConversationId: `cc-connect:${btoa(conversationId)}`, platform: 'qq', coworkSessionId: 'cowork-1' } as never,
      ],
    },
    { addMessage } as never,
  );
  transport.attach('account', { send });
  await transport.send({
    task,
    run: {} as never,
    content: 'partial answer\n\n截断披露',
    truncated: true,
  });
  expect(addMessage).toHaveBeenCalledWith(
    'cowork-1',
    expect.objectContaining({
      type: 'assistant',
      content: 'partial answer\n\n截断披露',
      metadata: expect.objectContaining({
        source: 'scheduled_task_delivery',
        answerTruncated: true,
      }),
    }),
  );

  addMessage.mockClear();
  await transport.send({ task, run: {} as never, content: 'clean answer', truncated: false });
  expect(addMessage).toHaveBeenCalledWith(
    'cowork-1',
    expect.objectContaining({
      metadata: expect.objectContaining({ source: 'scheduled_task_delivery' }),
    }),
  );
  expect(addMessage.mock.calls[0]?.[1]).not.toHaveProperty('metadata.answerTruncated');
});
