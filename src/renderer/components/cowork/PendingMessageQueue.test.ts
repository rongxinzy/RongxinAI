// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
} from '../../../shared/cowork/pendingMessageQueue';
import PendingMessageQueue from './PendingMessageQueue';
import { i18nService } from '../../services/i18n';

afterEach(cleanup);

test('inputs handed to the runtime are read-only and the retired promotion shortcut is not captured', async () => {
  const items = [
    {
      id: 'accepted',
      text: 'Please read the next document',
      createdAt: 1,
      status: CoworkQueueItemStatus.Pending,
      delivery: CoworkQueueDelivery.FollowUp,
    },
  ];
  const unsubscribe = vi.fn();
  const service = {
    subscribe: vi.fn((_id, listener) => {
      listener(items);
      return unsubscribe;
    }),
    load: vi.fn(async () => items),
  };
  const view = render(
    createElement(PendingMessageQueue, {
      sessionId: 'work',
      isStreaming: true,
      queueService: service,
    }),
  );
  await screen.findByText(items[0].text);
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  const shortcut = new KeyboardEvent('keydown', {
    key: 'Enter',
    ctrlKey: true,
    shiftKey: true,
    cancelable: true,
  });
  window.dispatchEvent(shortcut);
  expect(shortcut.defaultPrevented).toBe(false);
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test('an application-owned draft queue keeps its explicit actions', async () => {
  const items = [
    {
      id: 'draft',
      text: 'Draft held outside the runtime',
      createdAt: 1,
      status: CoworkQueueItemStatus.Pending,
      delivery: CoworkQueueDelivery.FollowUp,
    },
  ];
  const service = {
    subscribe: vi.fn((_id, listener) => {
      listener(items);
      return () => {};
    }),
    load: vi.fn(async () => items),
  };
  const actions = {
    update: vi.fn(async () => ({ success: true })),
    remove: vi.fn(async () => ({ success: true })),
    steer: vi.fn(async () => ({ success: true })),
    followUp: vi.fn(async () => ({ success: true })),
  };
  render(
    createElement(PendingMessageQueue, {
      sessionId: 'coding',
      isStreaming: true,
      queueService: service,
      queueActions: actions,
    }),
  );
  await screen.findByText(items[0].text);
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('coworkQueueSteer') }));
  await vi.waitFor(() => expect(actions.steer.mock.calls).toEqual([['coding', 'draft']]));
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('edit') }));
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'Edited draft' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await vi.waitFor(() =>
    expect(actions.update.mock.calls).toEqual([['coding', 'draft', 'Edited draft']]),
  );
});
