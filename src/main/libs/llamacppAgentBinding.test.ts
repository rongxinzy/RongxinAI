import { expect, test } from 'vitest';

import {
  assessLlamaCppAgentEligibility,
  buildLlamaCppRunningModelBinding,
  deriveLlamaCppAgentMaxTokens,
  LLAMACPP_AGENT_MIN_CONTEXT_WINDOW,
  LlamaCppAgentEligibilityReason,
} from './llamacppAgentBinding';

test('buildLlamaCppRunningModelBinding uses runtime context length for Agent contextWindow', () => {
  expect(
    buildLlamaCppRunningModelBinding({
      name: 'qwen-local',
      details: { context_length: 32768 },
      trained_context_length: 32768,
      runtime_context_length: 32768,
    }),
  ).toEqual({
    id: 'qwen-local',
    name: 'qwen-local',
    supportsImage: false,
    contextWindow: 32768,
    contextTokens: 32768,
    maxTokens: 4096,
    agentEligibility: {
      eligible: true,
      reason: LlamaCppAgentEligibilityReason.Eligible,
      requiredContextWindow: LLAMACPP_AGENT_MIN_CONTEXT_WINDOW,
      runtimeContextWindow: 32768,
      trainedContextWindow: 32768,
      canIncreaseContextWindow: false,
    },
  });
});

test('buildLlamaCppRunningModelBinding caps Agent maxTokens below the runtime context window', () => {
  expect(deriveLlamaCppAgentMaxTokens(4096)).toBe(1024);
  expect(deriveLlamaCppAgentMaxTokens(8192)).toBe(2048);
  expect(deriveLlamaCppAgentMaxTokens(16384)).toBe(4096);
  expect(deriveLlamaCppAgentMaxTokens(32768)).toBe(4096);
});

test('buildLlamaCppRunningModelBinding keeps running models with unknown runtime context but marks them ineligible for Agent', () => {
  expect(
    buildLlamaCppRunningModelBinding({
      name: 'qwen-local',
      details: { context_length: 32768 },
      trained_context_length: 32768,
    }),
  ).toEqual({
    id: 'qwen-local',
    name: 'qwen-local',
    supportsImage: false,
    agentEligibility: {
      eligible: false,
      reason: LlamaCppAgentEligibilityReason.RuntimeContextUnknown,
      requiredContextWindow: LLAMACPP_AGENT_MIN_CONTEXT_WINDOW,
      trainedContextWindow: 32768,
      canIncreaseContextWindow: false,
    },
  });
});

test('buildLlamaCppRunningModelBinding keeps smaller runtime contexts but marks them fixable for Agent', () => {
  expect(
    buildLlamaCppRunningModelBinding({
      name: 'qwen-local',
      trained_context_length: 32768,
      runtime_context_length: 4096,
    }),
  ).toEqual({
    id: 'qwen-local',
    name: 'qwen-local',
    supportsImage: false,
    contextWindow: 4096,
    contextTokens: 4096,
    maxTokens: 1024,
    agentEligibility: {
      eligible: false,
      reason: LlamaCppAgentEligibilityReason.RuntimeContextTooSmall,
      requiredContextWindow: LLAMACPP_AGENT_MIN_CONTEXT_WINDOW,
      runtimeContextWindow: 4096,
      trainedContextWindow: 32768,
      canIncreaseContextWindow: true,
    },
  });
});

test('assessLlamaCppAgentEligibility rejects models whose trained window is below the Agent minimum', () => {
  expect(
    assessLlamaCppAgentEligibility({
      runtimeContextWindow: 4096,
      trainedContextWindow: 8192,
    }),
  ).toEqual({
    eligible: false,
    reason: LlamaCppAgentEligibilityReason.TrainedContextTooSmall,
    requiredContextWindow: LLAMACPP_AGENT_MIN_CONTEXT_WINDOW,
    runtimeContextWindow: 4096,
    trainedContextWindow: 8192,
    canIncreaseContextWindow: false,
  });
});
