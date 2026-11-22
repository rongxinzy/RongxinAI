import { beforeEach, expect, test } from 'vitest';

import { assessLlamaCppAgentEligibility } from '../../shared/llamacpp';
import { setLanguage } from '../i18n';
import {
  assertLlamaCppWorkModeContext,
  assertWorkModeContextWindow,
} from './llamacppWorkModeContextGuard';

beforeEach(() => {
  setLanguage('en');
});

test('assertLlamaCppWorkModeContext rejects models below the agent context minimum', () => {
  const eligibility = assessLlamaCppAgentEligibility({
    runtimeContextWindow: 8192,
  });
  expect(() => assertLlamaCppWorkModeContext(eligibility)).toThrow(
    /too small a context window \(8192\)/,
  );
});

test('assertLlamaCppWorkModeContext rejects a local GPU model missing from the live snapshot', () => {
  expect(() => assertLlamaCppWorkModeContext(null)).toThrow(/not running/i);
});

test('assertWorkModeContextWindow rejects small-context models across all providers', () => {
  expect(() =>
    assertWorkModeContextWindow({
      modelId: 'ollama/llama3:8b',
      contextWindow: 4096,
    }),
  ).toThrow(/context window \(4096 tokens\) is below the minimum 16384 required for Work mode/);

  expect(() =>
    assertWorkModeContextWindow({
      modelId: 'ernie-4.5-8k',
      contextWindow: 8192,
    }),
  ).toThrow(/context window \(8192 tokens\) is below the minimum 16384 required for Work mode/);

  expect(() =>
    assertWorkModeContextWindow({
      modelId: 'custom-model',
      contextWindow: 16384,
    }),
  ).not.toThrow();

  expect(() =>
    assertWorkModeContextWindow({
      modelId: 'deepseek-chat',
      contextWindow: 65536,
    }),
  ).not.toThrow();

  expect(() =>
    assertWorkModeContextWindow({
      modelId: 'unprobed-model',
      contextWindow: undefined,
    }),
  ).not.toThrow();
});
