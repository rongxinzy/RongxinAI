import { describe, expect, test } from 'vitest';
import type { CoworkMessage } from '../../types/cowork';
import {
  formatCompactTokenCount,
  formatDuration,
  formatTokenRate,
  getSessionStats,
} from './sessionStats';

describe('getSessionStats', () => {
  test('aggregates verified usage and complete metrics from assistant and tool messages', () => {
    const messages: CoworkMessage[] = [
      { id: 'user-1', type: 'user', content: 'First task', timestamp: 1 },
      {
        id: 'assistant-1',
        type: 'assistant',
        content: 'First response',
        timestamp: 2,
        metadata: {
          usage: {
            inputTokens: 100,
            outputTokens: 30,
            cacheReadTokens: 20,
            cacheWriteTokens: 10,
          },
          metrics: {
            requestStartedAt: 1_000,
            firstVisibleTextAt: 1_400,
            completedAt: 3_000,
          },
        },
      },
      {
        id: 'tool-result',
        type: 'tool_result',
        content: 'Done',
        timestamp: 3,
        metadata: { metrics: { toolDurationMs: 900 } },
      },
      { id: 'user-2', type: 'user', content: 'Second task', timestamp: 4 },
      {
        id: 'assistant-2',
        type: 'assistant',
        content: 'Second response',
        timestamp: 5,
        metadata: {
          usage: { inputTokens: 20, outputTokens: 10, cacheReadTokens: 10 },
          metrics: {
            requestStartedAt: 4_000,
            firstVisibleTextAt: 4_400,
            completedAt: 6_000,
          },
        },
      },
      {
        id: 'assistant-incomplete',
        type: 'assistant',
        content: 'Still streaming',
        timestamp: 6,
        metadata: { metrics: { requestStartedAt: 7_000 } },
      },
    ];

    expect(getSessionStats(messages)).toEqual({
      turns: 2,
      steps: 3,
      inputTokens: 120,
      outputTokens: 40,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
      cacheHitPercent: null,
      llmDurationMs: 4_000,
      toolDurationMs: 900,
      ttftAverageMs: 400,
      throughputTokensPerSecond: 12.5,
    });
  });

  test('omits invalid and unavailable provider usage and incomplete timings', () => {
    const messages: CoworkMessage[] = [
      { id: 'user', type: 'user', content: 'Task', timestamp: 1 },
      {
        id: 'assistant',
        type: 'assistant',
        content: 'Response',
        timestamp: 2,
        metadata: {
          usage: { inputTokens: -1, outputTokens: Number.NaN, cacheReadTokens: Infinity },
          metrics: {
            requestStartedAt: 3_000,
            firstVisibleTextAt: 2_000,
            completedAt: 1_000,
          },
        },
      },
      {
        id: 'tool',
        type: 'tool_result',
        content: 'Failed',
        timestamp: 3,
        metadata: { metrics: { toolDurationMs: -10 } },
      },
    ];

    expect(getSessionStats(messages)).toEqual({
      turns: 1,
      steps: 0,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      cacheHitPercent: null,
      llmDurationMs: null,
      toolDurationMs: null,
      ttftAverageMs: null,
      throughputTokensPerSecond: null,
    });
  });

  test('does not derive cache hit from partial usage across messages', () => {
    const messages: CoworkMessage[] = [
      { id: 'user', type: 'user', content: 'Task', timestamp: 1 },
      { id: 'a', type: 'assistant', content: 'A', timestamp: 2, metadata: { usage: { inputTokens: 100 } } },
      { id: 'b', type: 'assistant', content: 'B', timestamp: 3, metadata: { usage: { cacheReadTokens: 50, cacheWriteTokens: 0 } } },
    ];
    expect(getSessionStats(messages).cacheHitPercent).toBeNull();
  });

  test('ignores aggregate overflow', () => {
    const messages: CoworkMessage[] = [
      { id: 'a', type: 'assistant', content: 'A', timestamp: 1, metadata: { usage: { inputTokens: Number.MAX_VALUE } } },
      { id: 'b', type: 'assistant', content: 'B', timestamp: 2, metadata: { usage: { inputTokens: Number.MAX_VALUE } } },
    ];
    expect(getSessionStats(messages).inputTokens).toBe(Number.MAX_VALUE);
  });

  test('omits cache hit when the provider did not verify every billed-input value', () => {
    const messages: CoworkMessage[] = [
      {
        id: 'assistant',
        type: 'assistant',
        content: 'Response',
        timestamp: 1,
        metadata: { usage: { cacheReadTokens: 100 } },
      },
    ];

    expect(getSessionStats(messages).cacheHitPercent).toBeNull();
  });
});

describe('session statistics formatters', () => {
  test('formats compact token counts, durations, and token rates', () => {
    expect(formatCompactTokenCount(999)).toBe('999');
    expect(formatCompactTokenCount(1_400)).toBe('1.4K');
    expect(formatCompactTokenCount(1_250_000)).toBe('1.3M');
    expect(formatDuration(850)).toBe('850ms');
    expect(formatDuration(61_200)).toBe('1m 1s');
    expect(formatTokenRate(12.34)).toBe('12.3 tok/s');
    expect(formatTokenRate(null)).toBeNull();
  });
});
