import { expect, test } from 'vitest';
import { CoworkRunPolicy } from './runState';
import {
  isPiUiEvent,
  PiUiEventSequenceTracker,
  PiUiEventSequencer,
  PiUiEventType,
} from './piUiEvent';

test('content patches share the canonical event sequence and validate bounded payloads', () => {
  const sequencer = new PiUiEventSequencer(() => crypto.randomUUID());
  const event = sequencer.next({
    type: PiUiEventType.ContentPatch,
    sessionId: 'a',
    patch: {
      sessionId: 'a',
      messageId: 'm',
      revision: 1,
      baseRevision: 0,
      offset: 0,
      content: 'text',
      totalLength: 4,
      complete: true,
      truncated: false,
    },
  });
  if (event.type !== PiUiEventType.ContentPatch) throw new Error('Expected content patch');
  expect(isPiUiEvent(event)).toBe(true);
  expect(sequencer.next({ type: PiUiEventType.Completed, sessionId: 'a' }).sequence).toBe(2);
  expect(isPiUiEvent({ ...event, patch: { ...event.patch, sessionId: 'b' } })).toBe(false);
  expect(isPiUiEvent({ ...event, patch: { ...event.patch, offset: -1 } })).toBe(false);
  expect(
    isPiUiEvent({
      ...event,
      patch: { ...event.patch, content: 'x'.repeat(CoworkRunPolicy.ContentChunkCharacters + 1) },
    }),
  ).toBe(false);
});

test('sequences events independently per session and globally for dismissals', () => {
  let id = 0;
  const sequencer = new PiUiEventSequencer(
    () => `event-${++id}`,
    () => 123,
  );
  const message = (sessionId: string) =>
    sequencer.next({
      type: PiUiEventType.Message,
      sessionId,
      message: { id: 'message-1', type: 'user', content: 'hello', timestamp: 1 },
    });

  expect(message('session-a')).toMatchObject({
    protocolVersion: 1,
    eventId: 'event-1',
    sequence: 1,
    emittedAt: 123,
  });
  expect(message('session-a').sequence).toBe(2);
  expect(message('session-b').sequence).toBe(1);
  expect(
    sequencer.next({
      type: PiUiEventType.PermissionDismiss,
      sessionId: null,
      requestId: 'request-1',
    }).sequence,
  ).toBe(1);
});

test('event validation rejects unversioned or incomplete payloads', () => {
  const sequencer = new PiUiEventSequencer(() => 'event-1');
  const event = sequencer.next({
    type: PiUiEventType.Completed,
    sessionId: 'session-a',
  });
  expect(event.protocolVersion).toBe(1);
  expect(event.sequence).toBe(1);
  expect(isPiUiEvent(event)).toBe(true);
  expect(isPiUiEvent({ ...event, protocolVersion: 0 })).toBe(false);
  expect(isPiUiEvent({ ...event, eventId: '' })).toBe(false);
  expect(isPiUiEvent({ type: PiUiEventType.Started })).toBe(false);
  expect(
    isPiUiEvent({
      ...event,
      type: PiUiEventType.Message,
      message: { id: 'm', type: 'assistant' },
    }),
  ).toBe(false);
  expect(
    isPiUiEvent({
      ...event,
      type: PiUiEventType.PermissionDismiss,
      sessionId: 'session-a',
      requestId: 'request-1',
    }),
  ).toBe(false);
});

test('sequence tracker drops duplicate and late deliveries per session', () => {
  const sequencer = new PiUiEventSequencer(
    () => crypto.randomUUID(),
    () => 123,
  );
  const tracker = new PiUiEventSequenceTracker();
  const first = sequencer.next({
    type: PiUiEventType.Started,
    sessionId: 'session-a',
  });
  const second = sequencer.next({
    type: PiUiEventType.Completed,
    sessionId: 'session-a',
  });

  expect(tracker.accept(first)).toBe(true);
  expect(tracker.accept(second)).toBe(true);
  expect(tracker.accept(second)).toBe(false);
  expect(tracker.accept({ ...first, sequence: 1 })).toBe(false);
});

test('sequence tracker exposes gaps so consumers can resync from persisted state', () => {
  const tracker = new PiUiEventSequenceTracker();
  const first = {
    protocolVersion: 1 as const,
    eventId: 'event-1',
    sequence: 1,
    emittedAt: 1,
    type: PiUiEventType.Started,
    sessionId: 'session-a',
  };
  const third = { ...first, eventId: 'event-3', sequence: 3 };

  expect(tracker.accept(first)).toBe(true);
  expect(tracker.accept(third)).toBe(true);
  expect(tracker.consumeGap('session-a')).toBe(1);
  expect(tracker.consumeGap('session-a')).toBe(0);
});

test('first delivery above sequence one requests recovery for a late subscriber', () => {
  const sequencer = new PiUiEventSequencer(() => crypto.randomUUID());
  sequencer.next({ type: PiUiEventType.Started, sessionId: 'A' });
  const tracker = new PiUiEventSequenceTracker();
  expect(
    tracker.accept(sequencer.next({ type: PiUiEventType.QueueUpdated, sessionId: 'A', items: [] })),
  ).toBe(true);
  expect(tracker.consumeGap('A')).toBe(1);
});
