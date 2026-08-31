import { expect, test, vi } from 'vitest';

import type { ScheduledTaskService } from '../../../scheduledTask/scheduledTaskService';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, handler);
    }),
  },
}));

import {
  DeliveryMode,
  IpcChannel,
  PayloadKind,
  SessionTarget,
} from '../../../scheduledTask/constants';
import { getCcConnectScopedConversationId } from '../../im/ccConnectConversationId';
import { t } from '../../i18n';
import { registerScheduledTaskHandlers } from './handlers';

test('task-list handler delegates to the canonical scheduler service', async () => {
  const listJobs = vi.fn(async () => []);
  registerScheduledTaskHandlers({
    getCronJobService: () => ({ listJobs }) as unknown as ScheduledTaskService,
    getIMGatewayManager: () => null,
  });
  const listHandler = electronMocks.handlers.get(IpcChannel.List);

  await expect(listHandler?.()).resolves.toEqual({ success: true, tasks: [] });
  expect(listJobs).toHaveBeenCalledOnce();
});

test('create preserves native conversation colons and full channel account IDs', async () => {
  const addJob = vi.fn(async input => ({ id: 'task-1', ...input }));
  registerScheduledTaskHandlers({
    getCronJobService: () => ({ addJob }) as unknown as ScheduledTaskService,
    getIMGatewayManager: () => null,
  });
  const input = {
    payload: { kind: PayloadKind.AgentTurn, message: 'Run' },
    delivery: {
      mode: DeliveryMode.Announce,
      channel: 'dingtalk-connector',
      to: 'group:with:colons',
      accountId: 'eb74163d-9aaa-4186-a526-36f249ca883b',
    },
  };

  await electronMocks.handlers.get(IpcChannel.Create)?.({}, input);

  expect(addJob).toHaveBeenCalledWith(
    expect.objectContaining({
      delivery: expect.objectContaining({
        to: 'group:with:colons',
        accountId: 'eb74163d-9aaa-4186-a526-36f249ca883b',
      }),
    }),
  );
  expect(input.delivery.to).toBe('group:with:colons');
});

test('create restores and validates scoped conversation ownership', async () => {
  const addJob = vi.fn(async input => ({ id: 'task-1', ...input }));
  registerScheduledTaskHandlers({
    getCronJobService: () => ({ addJob }) as unknown as ScheduledTaskService,
    getIMGatewayManager: () => null,
  });
  const create = electronMocks.handlers.get(IpcChannel.Create);
  const scopedId = getCcConnectScopedConversationId('account-one', 'group:with:colons');

  await expect(
    create?.(
      {},
      {
        payload: { kind: PayloadKind.AgentTurn, message: 'Run' },
        delivery: {
          mode: DeliveryMode.Announce,
          channel: 'dingtalk-connector',
          to: scopedId,
        },
      },
    ),
  ).resolves.toMatchObject({ success: true });
  expect(addJob).toHaveBeenLastCalledWith(
    expect.objectContaining({
      delivery: expect.objectContaining({
        accountId: 'account-one',
        to: 'group:with:colons',
      }),
    }),
  );

  await expect(
    create?.(
      {},
      {
        payload: { kind: PayloadKind.AgentTurn, message: 'Run' },
        delivery: {
          mode: DeliveryMode.Announce,
          channel: 'dingtalk-connector',
          accountId: 'account-two',
          to: scopedId,
        },
      },
    ),
  ).resolves.toMatchObject({ success: false, error: t('scheduledTaskDeliveryAccountMismatch') });
});

test('create preserves the selected execution binding when announce delivery is configured', async () => {
  const addJob = vi.fn(async input => ({ id: 'task-1', ...input }));
  registerScheduledTaskHandlers({
    getCronJobService: () => ({ addJob }) as unknown as ScheduledTaskService,
    getIMGatewayManager: () => null,
  });

  await electronMocks.handlers.get(IpcChannel.Create)?.(
    {},
    {
      sessionTarget: SessionTarget.Task,
      payload: { kind: PayloadKind.AgentTurn, message: 'Run' },
      delivery: {
        mode: DeliveryMode.Announce,
        channel: 'dingtalk-connector',
        to: 'group-1',
      },
    },
  );

  expect(addJob).toHaveBeenCalledWith(
    expect.objectContaining({ sessionTarget: SessionTarget.Task }),
  );
});

test('partial update does not inject a missing delivery field', async () => {
  const updateJob = vi.fn(async input => ({ id: 'task-1', ...input }));
  registerScheduledTaskHandlers({
    getCronJobService: () => ({ updateJob }) as unknown as ScheduledTaskService,
    getIMGatewayManager: () => null,
  });

  await electronMocks.handlers.get(IpcChannel.Update)?.({}, 'task-1', { enabled: false });

  expect(updateJob).toHaveBeenCalledWith('task-1', { enabled: false });
});

test('conversation and delivery handlers expose native routing records', async () => {
  const listDeliveries = vi.fn(async () => [{ id: 'delivery-1' }]);
  const scopedId = getCcConnectScopedConversationId('account-one', 'group:with:colons');
  registerScheduledTaskHandlers({
    getCronJobService: () => ({ listDeliveries }) as unknown as ScheduledTaskService,
    getIMGatewayManager: () => ({
      getIMStore: () => ({
        getSessionMapping: () => undefined,
        listSessionMappings: () => [
          {
            imConversationId: scopedId,
            platform: 'dingtalk',
            coworkSessionId: 'cowork-1',
            lastActiveAt: 1,
          },
        ],
      }),
    }),
  });

  await expect(
    electronMocks.handlers.get(IpcChannel.ListChannelConversations)?.(
      {},
      'dingtalk-connector',
      'account-one',
    ),
  ).resolves.toMatchObject({
    conversations: [{ conversationId: 'group:with:colons' }],
  });
  await expect(
    electronMocks.handlers.get(IpcChannel.ListDeliveries)?.({}, 'run-1'),
  ).resolves.toEqual({ success: true, deliveries: [{ id: 'delivery-1' }] });
});

test('preflight reports Delivery independently from the latest Run status', async () => {
  const latestDelivery = {
    id: 'delivery-1',
    status: 'error',
    error: 'channel offline',
  };
  registerScheduledTaskHandlers({
    getCronJobService: () =>
      ({
        getJob: vi.fn(async () => ({
          delivery: { mode: DeliveryMode.Announce, channel: 'dingtalk-connector' },
        })),
        listRuns: vi.fn(async () => [{ id: 'run-1', status: 'success', error: null }]),
        listDeliveries: vi.fn(async () => [latestDelivery]),
      }) as unknown as ScheduledTaskService,
    getIMGatewayManager: () => null,
  });

  await expect(
    electronMocks.handlers.get(IpcChannel.Preflight)?.({}, 'task-1'),
  ).resolves.toMatchObject({
    success: true,
    preflight: { latestDelivery },
  });
});
