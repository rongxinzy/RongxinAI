import { describe, expect, test } from 'vitest';

import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
} from '../../../shared/cowork/pendingMessageQueue';
import { PiPendingMessageQueue } from './piPendingMessageQueue';

describe('PiPendingMessageQueue', () => {
  test('preserves insertion order and only drains the requested delivery', () => {
    const queue = new PiPendingMessageQueue();
    const first = queue.enqueue('session-1', 'first');
    const second = queue.enqueue('session-1', 'second', CoworkQueueDelivery.Steer);

    expect(queue.list('session-1').map(item => item.id)).toEqual([first.id, second.id]);
    expect(queue.takeNext('session-1', CoworkQueueDelivery.FollowUp)).toMatchObject({
      id: first.id,
      status: CoworkQueueItemStatus.Sending,
    });
    expect(queue.takeNext('session-1', CoworkQueueDelivery.FollowUp)).toBeNull();
    expect(queue.list('session-1')).toHaveLength(1);
  });

  test('updates and restores a failed item without affecting other items', () => {
    const queue = new PiPendingMessageQueue();
    const first = queue.enqueue('session-1', 'first');
    const second = queue.enqueue('session-1', 'second');

    expect(queue.update('session-1', first.id, 'edited')?.text).toBe('edited');
    const taken = queue.take('session-1', first.id);
    expect(taken?.id).toBe(first.id);
    const restored = queue.restore('session-1', { ...taken!, error: 'network' });
    expect(restored).toMatchObject({
      id: first.id,
      text: 'edited',
      status: CoworkQueueItemStatus.Failed,
      error: 'network',
    });
    expect(queue.list('session-1').map(item => item.id)).toEqual([first.id, second.id]);
    expect(queue.takeNext('session-1', CoworkQueueDelivery.FollowUp)?.id).toBe(second.id);
  });

  test('keeps queued attachment metadata through delivery and retry', () => {
    const queue = new PiPendingMessageQueue();
    const queued = queue.enqueue(
      'session-1',
      'review the attachments',
      CoworkQueueDelivery.FollowUp,
      [{ name: 'screen.png', mimeType: 'image/png', base64Data: 'image-data' }],
      [{ name: 'brief.docx', path: '/tmp/brief.docx', extension: 'DOCX' }],
      ['skill-docx'],
      'Use the document skill.',
    );

    const taken = queue.takeNext('session-1', CoworkQueueDelivery.FollowUp);
    expect(taken).toMatchObject({
      id: queued.id,
      imageAttachments: [{ name: 'screen.png' }],
      fileAttachments: [{ name: 'brief.docx', extension: 'DOCX' }],
    });

    const restored = queue.restore('session-1', { ...taken!, error: 'retry' });
    expect(restored.fileAttachments?.[0]?.path).toBe('/tmp/brief.docx');
    expect(restored.imageAttachments?.[0]?.base64Data).toBe('image-data');
    expect(restored.skillIds).toEqual(['skill-docx']);
    expect(restored.skillPrompt).toBe('Use the document skill.');
  });

  test('does not take an item through the wrong delivery path', () => {
    const queue = new PiPendingMessageQueue();
    const steer = queue.enqueue('session-1', 'steer', CoworkQueueDelivery.Steer);

    expect(queue.take('session-1', steer.id, CoworkQueueDelivery.FollowUp)).toBeNull();
    expect(queue.findNextPending('session-1', CoworkQueueDelivery.Steer)?.id).toBe(steer.id);
  });

  test('isolates sessions and clears one session only', () => {
    const queue = new PiPendingMessageQueue();
    queue.enqueue('session-1', 'one');
    queue.enqueue('session-2', 'two');

    expect(queue.clear('session-1')).toBe(true);
    expect(queue.list('session-1')).toEqual([]);
    expect(queue.list('session-2')).toHaveLength(1);
  });
});
