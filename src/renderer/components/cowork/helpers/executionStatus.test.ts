import { expect, test } from 'vitest';

import type { AssistantTurnItem } from './messageGrouping';
import { CoworkToolActivityPhase } from '../../../../shared/cowork/toolActivity';
import { i18nService } from '../../../services/i18n';
import {
  ExecutionStatusKind,
  formatGeneratedCharacterCount,
  getExecutionStatusText,
  getFinalAnswerIndex,
  getToolActivityExecutionStatus,
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

test('formats a transient Write activity before tool execution starts', () => {
  expect(
    getToolActivityExecutionStatus({
      toolCallId: 'write-1',
      phase: CoworkToolActivityPhase.Preparing,
      toolName: 'Write',
      toolInput: { path: 'src/app.ts' },
      progress: { argsChars: 2_048 },
      updatedAt: 1,
    }),
  ).toEqual({
    kind: ExecutionStatusKind.Tool,
    toolName: 'Write',
    target: 'src/app.ts',
    progress: { argsChars: 2_048 },
  });
});

test('formats generated character counts with compact units', () => {
  expect(formatGeneratedCharacterCount(0)).toBe('0');
  expect(formatGeneratedCharacterCount(999)).toBe('999');
  expect(formatGeneratedCharacterCount(1_000)).toBe('1k');
  expect(formatGeneratedCharacterCount(12_400)).toBe('12.4k');
  expect(formatGeneratedCharacterCount(2_500_000)).toBe('2.5M');
});

test('appends generated character progress to the tool status text', () => {
  const withProgress = getExecutionStatusText({
    kind: ExecutionStatusKind.Tool,
    toolName: 'Write',
    target: 'report.md',
    progress: { argsChars: 12_400 },
  });
  expect(withProgress).toContain(i18nService.t('coworkExecutionWrite'));
  expect(withProgress).toContain('report.md');
  expect(withProgress).toContain('12.4k');

  const withoutProgress = getExecutionStatusText({
    kind: ExecutionStatusKind.Tool,
    toolName: 'Write',
    target: 'report.md',
  });
  expect(withoutProgress).toBe(`${i18nService.t('coworkExecutionWrite')} report.md`);
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

test('uses the last completed answer as a fallback after the turn completes', () => {
  const completedAnswer: AssistantTurnItem = {
    type: 'assistant',
    message: {
      id: 'answer-1',
      type: 'assistant',
      content: 'Completed answer',
      timestamp: 1,
      metadata: { isStreaming: false, isFinal: true },
    },
  };
  const trailingThinking: AssistantTurnItem = {
    type: 'assistant',
    message: {
      id: 'thinking-1',
      type: 'assistant',
      content: 'Trailing internal step',
      timestamp: 2,
      metadata: { isThinking: true, isStreaming: false, isFinal: true },
    },
  };

  expect(getFinalAnswerIndex([completedAnswer, trailingThinking], false)).toBe(-1);
  expect(getFinalAnswerIndex([completedAnswer, trailingThinking], true)).toBe(0);
});

test('does not use a streaming answer as the completed fallback', () => {
  const completedAnswer: AssistantTurnItem = {
    type: 'assistant',
    message: {
      id: 'answer-0',
      type: 'assistant',
      content: 'Prior completed answer',
      timestamp: 0,
      metadata: { isStreaming: false, isFinal: true },
    },
  };
  const streamingAnswer: AssistantTurnItem = {
    type: 'assistant',
    message: {
      id: 'answer-1',
      type: 'assistant',
      content: 'Still streaming',
      timestamp: 1,
      metadata: { isStreaming: true, isFinal: false },
    },
  };

  expect(getFinalAnswerIndex([completedAnswer, streamingAnswer], true)).toBe(-1);
});

test('uses the completed fallback even when a tool result is missing after the turn ends', () => {
  const completedAnswer: AssistantTurnItem = {
    type: 'assistant',
    message: {
      id: 'answer-1',
      type: 'assistant',
      content: 'Intermediate answer',
      timestamp: 1,
      metadata: { isStreaming: false, isFinal: true },
    },
  };

  // 2026/09/20 lixiang  issue #805：轮次结束后不因孤儿工具态隐藏最终回答
  expect(
    getFinalAnswerIndex(
      [completedAnswer, toolGroup('read-1', 'read', { path: 'src/app.ts' })],
      true,
    ),
  ).toBe(0);
  expect(
    getFinalAnswerIndex(
      [completedAnswer, toolGroup('read-1', 'read', { path: 'src/app.ts' })],
      false,
    ),
  ).toBe(-1);
});

test('keeps an explicit final answer when completed steps follow it', () => {
  const finalAnswer: AssistantTurnItem = {
    type: 'assistant',
    message: {
      id: 'answer-1',
      type: 'assistant',
      content: 'Final answer',
      timestamp: 1,
      metadata: { isStreaming: false, isFinal: true, isFinalAnswer: true },
    },
  };
  const trailingThinking: AssistantTurnItem = {
    type: 'assistant',
    message: {
      id: 'thinking-1',
      type: 'assistant',
      content: 'Trailing internal step',
      timestamp: 2,
      metadata: { isThinking: true, isStreaming: false, isFinal: true },
    },
  };

  expect(getFinalAnswerIndex([finalAnswer, trailingThinking])).toBe(0);
});
