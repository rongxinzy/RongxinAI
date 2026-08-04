import { expect, test } from 'vitest';

import { DirectChatTurnState } from './directChatTurnState';

test('keeps thinking, tool, and follow-up thinking messages in stream order', () => {
  const turn = new DirectChatTurnState('assistant-1', 'thinking-1', () => 'thinking-2');

  turn.startReasoning();
  turn.markReasoningMessageAdded();
  turn.appendReasoning('before search');
  turn.finishReasoning();
  turn.addToolUse('tool-1', { query: 'latest news' });
  turn.addToolResult('tool-1', { results: ['result'] });
  turn.startReasoning();
  turn.markReasoningMessageAdded();
  turn.appendReasoning('after search');
  turn.finishReasoning();
  turn.appendAssistant('final answer');

  const messages = turn.messagesSnapshot;
  expect(messages.map(message => `${message.type}:${message.id}`)).toEqual([
    'assistant:thinking-1',
    'tool_use:tool-1',
    'tool_result:tool-1-result',
    'assistant:thinking-2',
    'assistant:assistant-1',
  ]);
  expect(messages[0].content).toBe('before search');
  expect(messages[3].content).toBe('after search');
  expect(messages[4].content).toBe('final answer');
  expect(messages[2].metadata?.toolUseId).toBe('tool-1');
});

test('keeps mutable stream state isolated from Redux-frozen message payloads', () => {
  const turn = new DirectChatTurnState('assistant-1', 'thinking-1');

  const thinkingStart = turn.startReasoning().message;
  Object.freeze(thinkingStart.metadata);
  Object.freeze(thinkingStart);
  turn.markReasoningMessageAdded();
  expect(turn.appendReasoning('reasoning').message.content).toBe('reasoning');
  expect(turn.finishReasoning()?.message.content).toBe('reasoning');

  const assistantStart = turn.startAssistant().message;
  Object.freeze(assistantStart.metadata);
  Object.freeze(assistantStart);
  expect(turn.appendAssistant('answer').message.content).toBe('answer');
  expect(turn.messagesSnapshot.map(message => message.content)).toEqual(['reasoning', 'answer']);
});
