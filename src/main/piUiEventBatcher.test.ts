import { afterEach, expect, test, vi } from 'vitest';
import { PiUiEventSequencer, PiUiEventType, type PiUiEvent } from '../shared/cowork/piUiEvent';
import { createPiUiEventBatcher } from './piUiEventBatcher';

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const events: PiUiEvent[] = [];
  const sequencer = new PiUiEventSequencer(() => crypto.randomUUID());
  const send = createPiUiEventBatcher(payload => events.push(sequencer.next(payload)));
  const update = (content: string, sessionId = 'session', messageId = 'message') =>
    send({ type: PiUiEventType.MessageUpdate, sessionId, messageId, content });
  return { events, send, update };
}

test('coalesces replacements before sequencing without artificial recovery gaps', () => {
  const { events, send, update } = setup();
  send({ type: PiUiEventType.Started, sessionId: 'session' });
  update('a');
  update('ab');
  update('abc');
  vi.advanceTimersByTime(31);
  expect(events).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(events[1]).toMatchObject({ content: 'abc', sequence: 2 });
});

test.each([PiUiEventType.Stopped, PiUiEventType.Completed])(
  'flushes content before %s and cancels the pending timer',
  type => {
    const { events, send, update } = setup();
    update('final');
    send({ type, sessionId: 'session', claudeSessionId: null });
    expect(events.map(event => event.type)).toEqual([PiUiEventType.MessageUpdate, type]);
    expect(events.map(event => event.sequence)).toEqual([1, 2]);
    expect(vi.getTimerCount()).toBe(0);
  },
);

test('preserves session and message isolation and flushes before permission changes', () => {
  const { events, send, update } = setup();
  update('first', 'a', 'b:c');
  update('second', 'a:b', 'c');
  update('third', 'a', 'other');
  send({ type: PiUiEventType.PermissionDismiss, sessionId: null, requestId: 'request' });
  expect(events).toHaveLength(4);
  expect(events.slice(0, 3).map(event => event.sequence)).toEqual([1, 1, 2]);
  expect(events[3].type).toBe(PiUiEventType.PermissionDismiss);
  update('next');
  vi.advanceTimersByTime(32);
  expect(events[4]).toMatchObject({ content: 'next', sequence: 1 });
});
