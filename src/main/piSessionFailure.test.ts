import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';
import { classifyCoworkError } from '../common/coworkError';
import { CoworkSessionStatus } from '../shared/cowork/constants';
import { PiUiEventSequencer, PiUiEventType, type PiUiEvent } from '../shared/cowork/piUiEvent';
import { reportPiSessionFailure } from './piSessionFailure';

test('a rejected startup uses the runtime error listener and canonical message ordering', () => {
  const runtime = new EventEmitter();
  const sequencer = new PiUiEventSequencer(() => crypto.randomUUID());
  const events: PiUiEvent[] = [];
  const error = new Error('Connection refused');
  runtime.on('error', (sessionId, structured) => {
    expect(structured).toEqual(classifyCoworkError(error.message));
    events.push(
      sequencer.next({
        type: PiUiEventType.Message,
        sessionId,
        message: {
          id: 'terminal',
          type: 'system',
          content: '',
          timestamp: 1,
          metadata: { error: structured.message },
        },
      }),
    );
    events.push(sequencer.next({ type: PiUiEventType.Error, sessionId, error: structured }));
  });
  reportPiSessionFailure(runtime, 'session', error, CoworkSessionStatus.Idle);
  expect(events.map(event => [event.type, event.sequence])).toEqual([
    [PiUiEventType.Message, 1],
    [PiUiEventType.Error, 2],
  ]);
});

test('does not duplicate an error already persisted by the runtime', () => {
  const emit = vi.fn();
  reportPiSessionFailure({ emit }, 'session', new Error('failure'), CoworkSessionStatus.Error);
  expect(emit).not.toHaveBeenCalled();
});

test('classifies non-Error rejections too', () => {
  const runtime = new EventEmitter();
  const listener = vi.fn();
  runtime.on('error', listener);
  reportPiSessionFailure(runtime, 'session', 'Request timed out', CoworkSessionStatus.Running);
  expect(listener).toHaveBeenCalledWith('session', classifyCoworkError('Request timed out'));
});
