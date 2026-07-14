import { expect, test } from 'vitest';

import {
  getLlamaCppModelsMaxLimitViolation,
  resolveLlamaCppLaunchContext,
} from './launchValidation';

test('launch context keeps a request that fits the training limit', () => {
  expect(resolveLlamaCppLaunchContext({
    requestedContextLength: 32768,
    trainedContextLength: 32768,
  })).toEqual({
    effectiveContextLength: 32768,
    requestedContextLength: 32768,
    trainedContextLength: 32768,
    clamped: false,
  });

  expect(resolveLlamaCppLaunchContext({
    requestedContextLength: 16384,
    trainedContextLength: 32768,
  })).toEqual({
    effectiveContextLength: 16384,
    requestedContextLength: 16384,
    trainedContextLength: 32768,
    clamped: false,
  });
});

test('launch context clamps a request that exceeds the training limit', () => {
  expect(resolveLlamaCppLaunchContext({
    requestedContextLength: 32769,
    trainedContextLength: 32768,
  })).toEqual({
    effectiveContextLength: 32768,
    requestedContextLength: 32769,
    trainedContextLength: 32768,
    clamped: true,
  });
});

test('launch context keeps a request when training metadata is incomplete', () => {
  expect(resolveLlamaCppLaunchContext({
    requestedContextLength: 32769,
  })).toEqual({
    effectiveContextLength: 32769,
    requestedContextLength: 32769,
    trainedContextLength: undefined,
    clamped: false,
  });

  expect(resolveLlamaCppLaunchContext({
    trainedContextLength: 32768,
  })).toEqual({
    effectiveContextLength: undefined,
    requestedContextLength: undefined,
    trainedContextLength: 32768,
    clamped: false,
  });
});


test('modelsMax treats zero as the default limit of three models', () => {
  expect(getLlamaCppModelsMaxLimitViolation({
    modelsMax: '0',
    runningModelNames: ['a', 'b', 'c'],
    targetModelName: 'd',
  })).toEqual({
    limit: 3,
    next: 4,
  });
});

test('modelsMax allows loading when the target model is already running', () => {
  expect(getLlamaCppModelsMaxLimitViolation({
    modelsMax: '3',
    runningModelNames: ['a', 'b', 'c'],
    targetModelName: 'b',
  })).toBeNull();
});
