import { expect, test } from 'vitest';

import { resolveModelCapabilityContextWindow } from './ModelCapabilitySettingsModal';

const model = {
  name: 'local-model',
  runtime_context_length: 16_384,
  trained_context_length: 32_768,
};

test('uses the saved local model context before an older running context', () => {
  expect(
    resolveModelCapabilityContextWindow({
      model,
      preference: { ctxSize: 65_536 },
      runtimeContextWindow: 16_384,
    }),
  ).toBe(65_536);
});

test('falls back to the running model context when no saved context exists', () => {
  expect(
    resolveModelCapabilityContextWindow({
      model,
      runtimeContextWindow: 16_384,
    }),
  ).toBe(16_384);
});
