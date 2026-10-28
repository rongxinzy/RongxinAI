import { expect, test } from 'vitest';

import {
  CodingEventKind,
  CodingStreamUpdateMode,
  type CodingEvent,
} from '../../../shared/codingAgent';
import { CodingConversationTurnStatus } from './constants';
import { projectCodingEventsIncremental } from './codingEventProjectionCache';

const event = (
  sequence: number,
  kind: CodingEvent['kind'],
  payload: Record<string, unknown>,
): CodingEvent => ({
  id: `event-${sequence}`,
  laneId: 'lane-1',
  sequence,
  kind,
  payload,
  createdAt: sequence,
});

const user = event(1, CodingEventKind.Message, { role: 'user', content: 'hi' });
const answer = event(2, CodingEventKind.MessageDelta, {
  role: 'assistant',
  messageId: 'answer-1',
  content: 'done',
  streamUpdateMode: CodingStreamUpdateMode.Replace,
});
const complete = event(3, CodingEventKind.TurnComplete, {});
const tool = event(4, CodingEventKind.ToolCall, { toolCallId: 'call-1', title: 'Read' });

test('reuses a completed turn when a later turn grows', () => {
  const first = projectCodingEventsIncremental([user, answer, complete], null);
  expect(first.turns[0].status).toBe(CodingConversationTurnStatus.Complete);

  const followUp = event(5, CodingEventKind.Message, { role: 'user', content: 'next' });
  const partial = event(6, CodingEventKind.MessageDelta, {
    role: 'assistant',
    messageId: 'answer-2',
    content: 'B',
    streamUpdateMode: CodingStreamUpdateMode.Replace,
  });
  const second = projectCodingEventsIncremental(
    [user, answer, complete, followUp, partial],
    first.cache,
  );
  expect(second.turns[0]).toBe(first.turns[0]);
  expect(second.turns[1].assistantMessages[0].content).toBe('B');

  const grown = {
    ...partial,
    payload: { ...partial.payload, content: 'BB' },
  };
  const third = projectCodingEventsIncremental(
    [user, answer, complete, followUp, grown],
    second.cache,
  );
  expect(third.turns[0]).toBe(first.turns[0]);
  expect(third.turns[1]).not.toBe(second.turns[1]);
  expect(third.turns[1].assistantMessages[0].content).toBe('BB');
});

test('rebuilds a completed turn when one of its events changes', () => {
  const done = event(5, CodingEventKind.TurnComplete, {});
  const first = projectCodingEventsIncremental([user, tool, done], null);
  const updatedTool = { ...tool, payload: { ...tool.payload, output: 'file contents' } };
  const second = projectCodingEventsIncremental([user, updatedTool, done], first.cache);

  expect(second.turns[0]).not.toBe(first.turns[0]);
  expect(second.turns[0].activities[0].event.payload.output).toBe('file contents');
});

test('rebuilds an open turn when its message grows', () => {
  const partial = event(2, CodingEventKind.MessageDelta, {
    role: 'assistant',
    messageId: 'answer-1',
    content: 'A',
    streamUpdateMode: CodingStreamUpdateMode.Replace,
  });
  const first = projectCodingEventsIncremental([user, partial], null);
  expect(first.turns[0].status).toBeNull();

  const grown = { ...partial, payload: { ...partial.payload, content: 'AB' } };
  const second = projectCodingEventsIncremental([user, grown], first.cache);
  expect(second.turns[0]).not.toBe(first.turns[0]);
  expect(second.turns[0].assistantMessages[0].content).toBe('AB');
});
