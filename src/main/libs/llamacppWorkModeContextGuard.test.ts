import { beforeEach, expect, test, vi } from 'vitest';

import { LlamaCppAgentEligibilityReason } from '../../shared/llamacpp';
import { setLanguage } from '../i18n';

const mocks = vi.hoisted(() => ({
  isLlamaCppModelRunning: vi.fn(),
  getLlamaCppModelAgentEligibility: vi.fn(),
}));

vi.mock('./llamacppRunningModelRegistry', () => ({
  isLlamaCppModelRunning: mocks.isLlamaCppModelRunning,
  getLlamaCppModelAgentEligibility: mocks.getLlamaCppModelAgentEligibility,
}));

import {
  assertLlamaCppWorkModeContext,
  assertWorkModeContextWindow,
} from './llamacppWorkModeContextGuard';

beforeEach(() => {
  setLanguage('en');
  mocks.isLlamaCppModelRunning.mockReset();
  mocks.getLlamaCppModelAgentEligibility.mockReset();
});

test('assertLlamaCppWorkModeContext rejects models below the agent context minimum', () => {
  mocks.isLlamaCppModelRunning.mockReturnValue(true);
  mocks.getLlamaCppModelAgentEligibility.mockReturnValue({
    eligible: false,
    reason: LlamaCppAgentEligibilityReason.RuntimeContextTooSmall,
    requiredContextWindow: 32768,
    runtimeContextWindow: 8192,
    canIncreaseContextWindow: true,
  });

  expect(() =>
    assertLlamaCppWorkModeContext({
      providerName: 'llamacpp',
      modelId: 'llamacpp/qwen-local',
    }),
  ).toThrow(/too small a context window \(8192\)/);
});

test('assertLlamaCppWorkModeContext ignores non-llamacpp providers', () => {
  expect(() =>
    assertLlamaCppWorkModeContext({
      providerName: 'openai',
      modelId: 'openai/gpt-5.2',
    }),
  ).not.toThrow();
});

test('assertWorkModeContextWindow rejects small-context models across all providers', () => {
  expect(() =>
    assertWorkModeContextWindow({
      providerName: 'ollama',
      modelId: 'ollama/llama3:8b',
      contextWindow: 4096,
    }),
  ).toThrow(/context window \(4096 tokens\) is below the minimum 16384 required for Work mode/);

  expect(() =>
    assertWorkModeContextWindow({
      providerName: 'qianfan',
      modelId: 'ernie-4.5-8k',
      contextWindow: 8192,
    }),
  ).toThrow(/context window \(8192 tokens\) is below the minimum 16384 required for Work mode/);

  expect(() =>
    assertWorkModeContextWindow({
      providerName: 'openai-compatible',
      modelId: 'custom-model',
      contextWindow: 16384,
    }),
  ).not.toThrow();

  expect(() =>
    assertWorkModeContextWindow({
      providerName: 'deepseek',
      modelId: 'deepseek-chat',
      contextWindow: 65536,
    }),
  ).not.toThrow();

  expect(() =>
    assertWorkModeContextWindow({
      providerName: 'custom',
      modelId: 'unprobed-model',
      contextWindow: undefined,
    }),
  ).not.toThrow();
});
