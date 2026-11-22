/**
 * Regression guard for official @earendil-works/pi-ai overflow detection.
 */

import { test, expect } from 'vitest';
import { isContextOverflow } from '@earendil-works/pi-ai/compat';

type OverflowMessage = Parameters<typeof isContextOverflow>[0];

const buildMessage = (errorMessage: string): OverflowMessage =>
  ({
    role: 'assistant',
    content: [],
    stopReason: 'error',
    errorMessage,
    usage: { input: 200_000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 200_010 },
    timestamp: 1,
    provider: 'custom_ab',
    model: 'Qwen3.6-35B-A3B',
  }) as OverflowMessage;

test('recognizes the classic llama.cpp overflow message', () => {
  expect(
    isContextOverflow(
      buildMessage('the request exceeds the available context size, try increasing it'),
      262_144,
    ),
  ).toBe(true);
});

test('does not classify unrelated server errors as overflow', () => {
  expect(isContextOverflow(buildMessage('500 Internal Server Error'), 262_144)).toBe(false);
});
