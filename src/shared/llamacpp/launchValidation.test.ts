import { expect, test } from 'vitest';

import { getLlamaCppLaunchContextLimitViolation } from './launchValidation';

test('getLlamaCppLaunchContextLimitViolation returns null when requested context fits training limit', () => {
  expect(getLlamaCppLaunchContextLimitViolation({
    requestedContextLength: 32768,
    trainedContextLength: 32768,
  })).toBeNull();

  expect(getLlamaCppLaunchContextLimitViolation({
    requestedContextLength: 16384,
    trainedContextLength: 32768,
  })).toBeNull();
});

test('getLlamaCppLaunchContextLimitViolation reports overflow when requested context exceeds training limit', () => {
  expect(getLlamaCppLaunchContextLimitViolation({
    requestedContextLength: 32769,
    trainedContextLength: 32768,
  })).toEqual({
    requestedContextLength: 32769,
    trainedContextLength: 32768,
  });
});

test('getLlamaCppLaunchContextLimitViolation ignores incomplete context metadata', () => {
  expect(getLlamaCppLaunchContextLimitViolation({
    requestedContextLength: 32769,
  })).toBeNull();

  expect(getLlamaCppLaunchContextLimitViolation({
    trainedContextLength: 32768,
  })).toBeNull();
});
