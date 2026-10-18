import { expect, test } from 'vitest';

import { CodingEventKind, type CodingEvent } from '../../../shared/codingAgent';
import { collectInlineArtifacts } from '../../services/inlineArtifacts';
import { toDetectableCodingMessages } from './codingArtifactMessages';
import { projectCodingEvents } from './codingEventProjection';

test('marks a final coding answer as detectable for inline code-block artifacts', () => {
  const events: CodingEvent[] = [
    {
      id: 'assistant-1',
      laneId: 'lane-1',
      sequence: 1,
      kind: CodingEventKind.MessageDelta,
      payload: {
        role: 'assistant',
        messageId: 'assistant-1',
        content: 'Here is the page:\n\n```html\n<h1>report</h1>\n```',
      },
      createdAt: 1,
    },
    {
      id: 'complete-1',
      laneId: 'lane-1',
      sequence: 2,
      kind: CodingEventKind.TurnComplete,
      payload: {},
      createdAt: 2,
    },
  ];

  const messages = toDetectableCodingMessages(projectCodingEvents(events));
  const artifacts = collectInlineArtifacts(messages, 'lane-1');

  expect(artifacts).toEqual([
    expect.objectContaining({
      messageId: 'assistant-1',
      source: 'codeblock',
      content: '<h1>report</h1>',
    }),
  ]);
});

test('keeps blank answers out of the detectable message set', () => {
  const events: CodingEvent[] = [
    {
      id: 'assistant-1',
      laneId: 'lane-1',
      sequence: 1,
      kind: CodingEventKind.MessageDelta,
      payload: { role: 'assistant', messageId: 'assistant-1', content: '   ' },
      createdAt: 1,
    },
    {
      id: 'complete-1',
      laneId: 'lane-1',
      sequence: 2,
      kind: CodingEventKind.TurnComplete,
      payload: {},
      createdAt: 2,
    },
  ];

  expect(toDetectableCodingMessages(projectCodingEvents(events))).toEqual([]);
});
