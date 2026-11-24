import { expect, test } from 'vitest';

import {
  assessLlamaCppAgentEligibility,
  buildLlamaCppRunningModelBinding,
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
    contextWindow: 32768,
    maxTokens: 32768,
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

test.each([4096, 8192, 16384, 32768, 65536])(
  'uses Pi native default output ceiling for a %i-token runtime',
  window => {
    expect(
      buildLlamaCppRunningModelBinding({ name: 'local', runtime_context_length: window }),
    ).toMatchObject({ contextWindow: window, maxTokens: window });
  },
);

test('publishes model preferences without advertising capacity beyond the loaded runtime', () => {
  const running = { name: 'qwen-local', runtime_context_length: 32768 };
  expect(
    buildLlamaCppRunningModelBinding(running, {
      'qwen-local': { ctxSize: 65536, maxTokens: 1024 },
    }),
  ).toMatchObject({
    contextWindow: 32768,
    maxTokens: 1024,
    agentEligibility: { eligible: true, runtimeContextWindow: 32768 },
  });
  expect(
    buildLlamaCppRunningModelBinding(running, {
      'qwen-local': { ctxSize: 16384, maxTokens: 65536 },
    }),
  ).toMatchObject({
    contextWindow: 16384,
    maxTokens: 16384,
    agentEligibility: {
      eligible: false,
      reason: LlamaCppAgentEligibilityReason.RuntimeContextTooSmall,
      runtimeContextWindow: 16384,
      requiredContextWindow: 32768,
      canIncreaseContextWindow: true,
    },
  });
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
    contextWindow: 4096,
    maxTokens: 4096,
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
