import { expect, test } from 'vitest';

import { CoworkInterruptionCause } from '../../../../shared/cowork/interruption';
import type { CoworkMessage } from '../../../types/cowork';
import {
  buildConversationTurns,
  buildDisplayItems,
  buildTurnRailIndices,
  getVisibleAssistantItems,
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

test('keeps empty interruption messages visible while hiding other empty system messages', () => {
  const interruptionMessage: CoworkMessage = {
    ...message('interruption-1', 'system', ''),
    metadata: {
      interruption: {
        sessionId: 'session-1',
        interruptionId: 'interruption-1',
        cause: CoworkInterruptionCause.UserStop,
        taskId: null,
        recoverable: false,
      },
    },
  };
  const turn = buildTurns([
    message('user-1', 'user', 'run task'),
    interruptionMessage,
    message('system-1', 'system', ''),
  ])[0];

  expect(getVisibleAssistantItems(turn.assistantItems)).toEqual([
    { type: 'system', message: interruptionMessage },
  ]);
});

// ── Scale fixtures (issue #141: 20/200/1000-turn sessions) ──

const buildFixtureMessages = (turnCount: number): CoworkMessage[] => {
  const messages: CoworkMessage[] = [];
  for (let i = 0; i < turnCount; i++) {
    messages.push(message(`user-${i}`, 'user', `question ${i}`));
    messages.push(message(`tool-${i}`, 'tool_use', `read file ${i}`));
    messages.push(message(`assistant-${i}`, 'assistant', `answer ${i}`));
  }
  return messages;
};

for (const turnCount of [20, 200, 1000]) {
  test(`groups and numbers a ${turnCount}-turn session`, () => {
    const turns = buildTurns(buildFixtureMessages(turnCount));
    expect(turns).toHaveLength(turnCount);
    expect(turns[0]?.id).toBe('user-0');
    expect(turns[turnCount - 1]?.id).toBe(`user-${turnCount - 1}`);

    const indices = buildTurnRailIndices(turns);
    expect(indices[0]).toEqual({ user: 0, assistant: 1 });
    expect(indices[turnCount - 1]).toEqual({
      user: (turnCount - 1) * 2,
      assistant: (turnCount - 1) * 2 + 1,
    });
  });
}

test('a tail delta at 1000 turns only re-creates the tail turn', () => {
  const fixtureMessages = buildFixtureMessages(1000);
  const base = buildTurns(fixtureMessages);
  const streamed = buildTurns([
    ...fixtureMessages.slice(0, -1),
    message('assistant-999', 'assistant', 'answer 999 plus one token'),
  ]);

  const started = performance.now();
  const stabilized = stabilizeConversationTurns(base, streamed);
  const elapsedMs = performance.now() - started;

  for (let i = 0; i < 999; i++) {
    expect(stabilized[i]).toBe(base[i]);
  }
  expect(stabilized[999]).not.toBe(base[999]);
  expect(elapsedMs).toBeLessThan(500);
});

test('pagination prepend keeps existing turn references', () => {
  const fixtureMessages = buildFixtureMessages(50);
  const initial = buildTurns(fixtureMessages.slice(-100)); // turns ~17..49
  const prepended = stabilizeConversationTurns(initial, buildTurns(fixtureMessages));

  const initialById = new Map(initial.map(turn => [turn.id, turn]));
  for (const turn of prepended) {
    const previous = initialById.get(turn.id);
    if (previous?.userMessage) expect(turn).toBe(previous);
  }
  expect(prepended.length).toBe(50);
});

test('pagination keeps a partial turn key when its user message is prepended', () => {
  const completeMessages = [
    message('user-1', 'user', 'question'),
    message('assistant-1', 'assistant', 'first answer block'),
    message('tool-1', 'tool_use', 'read file'),
    message('tool-result-1', 'tool_result', 'file contents'),
    message('assistant-2', 'assistant', 'final answer block'),
  ];
  const partial = buildTurns(completeMessages.slice(2));

  expect(partial).toHaveLength(1);
  expect(partial[0]?.id).toBe('orphan:tool-1');

  const prepended = stabilizeConversationTurns(partial, buildTurns(completeMessages));

  expect(prepended).toHaveLength(1);
  expect(prepended[0]?.id).toBe('orphan:tool-1');
  expect(prepended[0]?.userMessage?.id).toBe('user-1');
});

test('pagination assigns unique keys when an earlier page also starts mid-turn', () => {
  const currentPage = buildTurns([
    message('assistant-b', 'assistant', 'partial B'),
    message('user-c', 'user', 'question C'),
    message('assistant-c', 'assistant', 'answer C'),
  ]);
  const withEarlierPage = buildTurns([
    message('assistant-a', 'assistant', 'partial A'),
    message('user-b', 'user', 'question B'),
    message('assistant-b', 'assistant', 'partial B'),
    message('user-c', 'user', 'question C'),
    message('assistant-c', 'assistant', 'answer C'),
  ]);

  const stabilized = stabilizeConversationTurns(currentPage, withEarlierPage);
  const turnIds = stabilized.map(turn => turn.id);

  expect(turnIds).toEqual(['orphan:assistant-a', 'orphan:assistant-b', 'user-c']);
  expect(new Set(turnIds).size).toBe(turnIds.length);
});
