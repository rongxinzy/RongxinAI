/**
 * Regression guard for the pi-ai overflow-pattern patch
 * (patches/@earendil-works+pi-ai+1.0.0.patch).
 *
 * llama.cpp reports context overflow with (at least) two message variants.
 * pi-ai's OVERFLOW_PATTERNS only matched "exceeds the available context
 * size"; the mid-stream SSE error frame variant "Context size has been
 * exceeded." fell through, so the SDK never ran overflow compaction and
 * the whole run died. If the patch is lost (e.g. an upgrade drops
 * patches/), this test fails.
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

test('recognizes the llama.cpp mid-stream overflow variant', () => {
  expect(isContextOverflow(buildMessage('500 "Context size has been exceeded."'), 262_144)).toBe(
    true,
  );
});

test('still recognizes the classic llama.cpp overflow message', () => {
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
