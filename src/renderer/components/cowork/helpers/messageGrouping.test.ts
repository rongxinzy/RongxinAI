import { expect, test } from 'vitest';

import type { CoworkMessage } from '../../../types/cowork';
import {
  buildConversationTurns,
  buildDisplayItems,
  buildTurnRailIndices,
  stabilizeConversationTurns,
} from './messageGrouping';

const message = (id: string, type: CoworkMessage['type'], content: string): CoworkMessage => ({
  id,
  type,
  content,
  timestamp: 1,
});

const buildTurns = (messages: CoworkMessage[]) =>
  buildConversationTurns(buildDisplayItems(messages));

test('keeps completed turn references stable when only the tail streams', () => {
  const history = [
    message('user-1', 'user', 'first question'),
    message('assistant-1', 'assistant', 'first answer'),
    message('user-2', 'user', 'second question'),
    message('assistant-2', 'assistant', 'partial'),
  ];
  const first = buildTurns(history);
  const second = stabilizeConversationTurns(
    first,
    buildTurns([...history.slice(0, 3), message('assistant-2', 'assistant', 'partially streamed')]),
  );

  expect(second[0]).toBe(first[0]);
  expect(second[1]).not.toBe(first[1]);
  expect(second[1]?.assistantItems[0]?.type).toBe('assistant');
});

test('reuses the previous turn array when nothing changed', () => {
  const turns = buildTurns([
    message('user-1', 'user', 'question'),
    message('assistant-1', 'assistant', 'answer'),
  ]);
  const again = stabilizeConversationTurns(turns, buildTurns([...turnsToMessages(turns)]));

  expect(again).toBe(turns);
});

const turnsToMessages = (turns: ReturnType<typeof buildTurns>): CoworkMessage[] => {
  const messages: CoworkMessage[] = [];
  for (const turn of turns) {
    if (turn.userMessage) messages.push(turn.userMessage);
    for (const item of turn.assistantItems) {
      if (item.type === 'tool_group') {
        messages.push(item.group.toolUse);
        if (item.group.toolResult) messages.push(item.group.toolResult);
      } else {
        messages.push(item.message);
      }
    }
  }
  return messages;
};

test('keeps tool group turns stable while an unrelated turn streams', () => {
  const history = [
    message('user-1', 'user', 'run a tool'),
    message('tool-1', 'tool_use', 'read file'),
    message('user-2', 'user', 'now stream'),
    message('assistant-2', 'assistant', 'chunk 1'),
  ];
  const first = buildTurns(history);
  const second = stabilizeConversationTurns(
    first,
    buildTurns([...history.slice(0, 3), message('assistant-2', 'assistant', 'chunk 1 2')]),
  );

  expect(second[0]).toBe(first[0]);
});

test('buildTurnRailIndices numbers user and assistant rail items from data', () => {
  const turns = buildTurns([
    message('user-1', 'user', 'first question'),
    message('assistant-1', 'assistant', 'first answer'),
    message('assistant-1b', 'assistant', ''),
    message('user-2', 'user', 'second question'),
    message('assistant-2', 'assistant', 'second answer'),
  ]);
  const indices = buildTurnRailIndices(turns);

  expect(indices).toEqual([
    { user: 0, assistant: 1 },
    { user: 2, assistant: 3 },
  ]);
});

test('buildTurnRailIndices skips turns without user or assistant content', () => {
  const turns = buildTurns([
    message('assistant-0', 'assistant', 'orphan answer'),
    message('user-1', 'user', 'question'),
    message('tool-1', 'tool_use', 'call'),
  ]);
  const indices = buildTurnRailIndices(turns);

  expect(indices[0]).toEqual({ user: -1, assistant: 0 });
  expect(indices[1]).toEqual({ user: 1, assistant: -1 });
});
