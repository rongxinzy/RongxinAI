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

import { assertLlamaCppWorkModeContext } from './llamacppWorkModeContextGuard';

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
