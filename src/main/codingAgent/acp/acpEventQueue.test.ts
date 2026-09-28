import { expect, test } from 'vitest';

import { AcpEventQueue, AcpEventQueueLimits } from './acpEventQueue';

type Event = { kind: string; payload: Record<string, unknown> };

test('merges adjacent events and enforces both queue limits', () => {
  const queue = new AcpEventQueue<Event>((previous, next) => {
    if (previous.kind !== 'message' || next.kind !== 'message') return null;
    return {
      kind: 'message',
      payload: {
        content: `${String(previous.payload.content)}${String(next.payload.content)}`,
      },
    };
  });

  expect(queue.enqueue({ kind: 'message', payload: { content: 'a' } }).accepted).toBe(true);
  const merged = queue.enqueue({ kind: 'message', payload: { content: 'b' } });
  expect(merged).toMatchObject({ accepted: true, replaced: { payload: { content: 'a' } } });
  expect(queue.dequeue()).toEqual({ kind: 'message', payload: { content: 'ab' } });

  const limited = new AcpEventQueue<Event>();
  const large = { kind: 'large', payload: { content: 'x'.repeat(AcpEventQueueLimits.MaxBytes) } };
  expect(limited.enqueue(large).accepted).toBe(false);
  expect(limited.length).toBe(0);
});
