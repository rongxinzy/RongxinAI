import { expect, test } from 'vitest';

import { getThinkingPresentation } from './thinkingPresentation';

test('keeps completed thinking independent from another active group item', () => {
  expect(
    getThinkingPresentation(
      {
        isThinking: true,
        isStreaming: false,
        isFinal: true,
        thinkingDurationMs: 2400,
      },
      false,
    ),
  ).toEqual({
    isStreaming: false,
    isComplete: true,
    durationSeconds: 3,
  });
});

test('marks only the message with streaming metadata as active', () => {
  expect(
    getThinkingPresentation({ isThinking: true, isStreaming: true, isFinal: false }, false),
  ).toEqual({
    isStreaming: true,
    isComplete: false,
    durationSeconds: undefined,
  });
});

test('forces historical thinking complete inside the final execution summary', () => {
  expect(
    getThinkingPresentation({ isThinking: true, isStreaming: true, isFinal: false }, true),
  ).toEqual({
    isStreaming: false,
    isComplete: true,
    durationSeconds: undefined,
  });
});
