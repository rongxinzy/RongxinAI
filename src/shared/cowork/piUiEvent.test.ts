import { expect, test } from 'vitest';
import {
  isPiUiEvent,
  PiUiEventSequenceTracker,
  PiUiEventSequencer,
  PiUiEventType,
} from './piUiEvent';

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
    claudeSessionId: null,
  });
  expect(event.protocolVersion).toBe(1);
  expect(event.sequence).toBe(1);
  expect(isPiUiEvent(event)).toBe(true);
  expect(isPiUiEvent({ ...event, protocolVersion: 0 })).toBe(false);
  expect(isPiUiEvent({ ...event, eventId: '' })).toBe(false);
  expect(isPiUiEvent({ type: PiUiEventType.Started })).toBe(false);
});

test('sequence tracker drops duplicate and late deliveries per session', () => {
  const sequencer = new PiUiEventSequencer(() => crypto.randomUUID(), () => 123);
  const tracker = new PiUiEventSequenceTracker();
  const first = sequencer.next({
    type: PiUiEventType.Started,
    sessionId: 'session-a',
  });
  const second = sequencer.next({
    type: PiUiEventType.Completed,
    sessionId: 'session-a',
    claudeSessionId: null,
  });

  expect(tracker.accept(first)).toBe(true);
  expect(tracker.accept(second)).toBe(true);
  expect(tracker.accept(second)).toBe(false);
  expect(tracker.accept({ ...first, sequence: 1 })).toBe(false);
});
