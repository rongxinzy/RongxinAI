import { expect, test } from 'vitest';

import { shouldRetryLocalInferenceSlot } from './localInferenceSlotRetry';

test('retries transient llama.cpp slot saturation errors', () => {
  expect(shouldRetryLocalInferenceSlot({ statusCode: 503 })).toBe(true);
  expect(shouldRetryLocalInferenceSlot({ message: 'all slots are busy' })).toBe(true);
  expect(shouldRetryLocalInferenceSlot({ statusCode: 401, message: 'invalid API key' })).toBe(false);
});
