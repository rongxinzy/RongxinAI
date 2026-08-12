import { expect, test } from 'vitest';

import { HarnessFailureWhere, HarnessFailureWhy, HarnessInfraStatus } from '../../shared/harness';
import { classifyHarnessFailure } from './failureClassifier';

test('separates retryable infrastructure failures from agent failures', () => {
  expect(classifyHarnessFailure({ message: 'upstream request timed out' })).toEqual({
    where: HarnessFailureWhere.Runtime,
    why: HarnessFailureWhy.InfraFailure,
    infraStatus: HarnessInfraStatus.Retryable,
    retryable: true,
  });

  expect(classifyHarnessFailure({ message: 'final answer did not satisfy the contract' })).toEqual({
    where: HarnessFailureWhere.Prompt,
    why: HarnessFailureWhy.UnverifiedDelivery,
    infraStatus: HarnessInfraStatus.NotApplicable,
    retryable: false,
  });
});

test('classifies configuration and capability failures as non-retryable', () => {
  expect(classifyHarnessFailure({ message: '401 invalid API key' })).toMatchObject({
    where: HarnessFailureWhere.Config,
    why: HarnessFailureWhy.InfraFailure,
    infraStatus: HarnessInfraStatus.Terminal,
    retryable: false,
  });
  expect(classifyHarnessFailure({ message: 'model context window exceeded' })).toMatchObject({
    why: HarnessFailureWhy.ModelCapabilityLimit,
    retryable: false,
  });
});
