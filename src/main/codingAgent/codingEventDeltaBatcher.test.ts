import { afterEach, expect, test, vi } from 'vitest';

import { CodingEventKind } from '../../shared/codingAgent';
import { CodingEventDeltaBatcher } from './codingEventDeltaBatcher';

afterEach(() => vi.useRealTimers());

test('coalesces updates for the same event before flushing', () => {
  vi.useFakeTimers();
  const onFlush = vi.fn();
  const batcher = new CodingEventDeltaBatcher(onFlush, 100);
  const first = {
    id: 'event-1',
    laneId: 'lane',
    sequence: 1,
    kind: CodingEventKind.MessageDelta,
    payload: { content: 'a' },
    createdAt: 1,
  };
  const second = { ...first, payload: { content: 'ab' } };

  batcher.enqueue('/workspace', first);
  batcher.enqueue('/workspace', second);
  vi.advanceTimersByTime(100);

  expect(onFlush).toHaveBeenCalledTimes(1);
  expect(onFlush).toHaveBeenCalledWith({ workspaceRoot: '/workspace', events: [second] });
  batcher.dispose();
});
