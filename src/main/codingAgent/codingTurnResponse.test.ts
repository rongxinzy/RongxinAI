import { expect, test } from 'vitest';

import { CodingEventKind } from '../../shared/codingAgent';
import { isAssistantResponseEvent } from './codingTurnResponse';

test('recognizes non-empty assistant message events', () => {
  expect(
    isAssistantResponseEvent({
      kind: CodingEventKind.MessageDelta,
      payload: { role: 'assistant', content: 'Done.' },
    }),
  ).toBe(true);
});

test('ignores user and empty message events', () => {
  expect(
    isAssistantResponseEvent({
      kind: CodingEventKind.Message,
      payload: { role: 'user', content: 'Prompt' },
    }),
  ).toBe(false);
  expect(
    isAssistantResponseEvent({
      kind: CodingEventKind.MessageDelta,
      payload: { role: 'assistant', content: '  ' },
    }),
  ).toBe(false);
});
