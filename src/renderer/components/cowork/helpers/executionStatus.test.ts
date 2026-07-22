import { expect, test } from 'vitest';

import type { AssistantTurnItem } from './messageGrouping';
import {
  ExecutionStatusKind,
  getCompletedExecutionSummaryText,
  getCurrentExecutionStatus,
  getExecutionSummary,
  getFinalAnswerIndex,
} from './executionStatus';

const toolGroup = (
  id: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  hasFailed = false,
): Extract<AssistantTurnItem, { type: 'tool_group' }> => ({
  type: 'tool_group',
  group: {
    type: 'tool_group',
    toolUse: {
      id: `use-${id}`,
      type: 'tool_use',
      content: '',
      timestamp: 1,
      metadata: { toolName, toolInput, toolUseId: id },
    },
    toolResult: hasFailed
      ? {
          id: `result-${id}`,
          type: 'tool_result',
          content: 'failed',
          timestamp: 2,
          metadata: { toolUseId: id, isError: true },
        }
      : undefined,
  },
});

test('prefers the latest active thinking status over prior tool calls', () => {
  const status = getCurrentExecutionStatus([
    toolGroup('read-1', 'read', { path: 'src/app.ts' }),
    {
      type: 'assistant',
      message: {
        id: 'thinking-1',
        type: 'assistant',
        content: 'checking the implementation',
        timestamp: 2,
        metadata: { isThinking: true, isStreaming: true, isFinal: false },
      },
    },
  ]);

  expect(status).toEqual({ kind: ExecutionStatusKind.Thinking });
});

test('includes a concise target for an active tool call', () => {
  const status = getCurrentExecutionStatus([
    toolGroup('read-1', 'read', { path: 'src/app.ts' }),
  ]);

  expect(status).toEqual({
    kind: ExecutionStatusKind.Tool,
    toolName: 'read',
    target: 'src/app.ts',
  });
});

test('summarizes completed and failed tool calls separately', () => {
  const summary = getExecutionSummary([
    toolGroup('read-1', 'read', { path: 'src/app.ts' }),
    toolGroup('write-1', 'write', { path: 'src/app.ts' }, true),
  ]);

  expect(summary).toEqual({
    thinkingSteps: 0,
    toolCalls: 2,
    completedTools: 0,
    failedTools: 1,
    incompleteTools: 1,
  });
});

test('formats completed execution counts for the static summary', () => {
  expect(
    getCompletedExecutionSummaryText({
      thinkingSteps: 2,
      toolCalls: 3,
      completedTools: 3,
      failedTools: 0,
      incompleteTools: 0,
    }),
  ).toBe('已完成 2 次思考、3 次工具调用');
});

test('omits zero-valued execution counts from the static summary', () => {
  expect(
    getCompletedExecutionSummaryText({
      thinkingSteps: 2,
      toolCalls: 0,
      completedTools: 0,
      failedTools: 0,
      incompleteTools: 0,
    }),
  ).toBe('已完成 2 次思考');
  expect(
    getCompletedExecutionSummaryText({
      thinkingSteps: 0,
      toolCalls: 3,
      completedTools: 3,
      failedTools: 0,
      incompleteTools: 0,
    }),
  ).toBe('已完成 3 次工具调用');
  expect(getCompletedExecutionSummaryText(null)).toBe('任务完成');
});

test('recognizes only an explicitly marked final answer', () => {
  const answer: AssistantTurnItem = {
    type: 'assistant',
    message: {
      id: 'answer-1',
      type: 'assistant',
      content: 'Here is the result',
      timestamp: 2,
      metadata: { isStreaming: true, isFinal: false },
    },
  };
  const finalAnswer: AssistantTurnItem = {
    type: 'assistant',
    message: {
      id: 'answer-2',
      type: 'assistant',
      content: 'Here is the final result',
      timestamp: 3,
      metadata: { isStreaming: false, isFinal: true, isFinalAnswer: true },
    },
  };
  const activeTool = toolGroup('read-1', 'read', { path: 'src/app.ts' });

  expect(getFinalAnswerIndex([activeTool, answer])).toBe(-1);
  expect(getFinalAnswerIndex([activeTool, answer, finalAnswer])).toBe(2);
});
