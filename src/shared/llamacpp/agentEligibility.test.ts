import { expect, test } from 'vitest';

import {
  assessLlamaCppAgentEligibility,
  LLAMACPP_AGENT_MIN_CONTEXT_WINDOW,
  LlamaCppAgentEligibilityReason,
} from './agentEligibility';

const required = LLAMACPP_AGENT_MIN_CONTEXT_WINDOW;

test('a runtime context at or above the requirement is eligible', () => {
  expect(
    assessLlamaCppAgentEligibility({
      runtimeContextWindow: required,
      trainedContextWindow: required * 2,
    }),
  ).toEqual({
    eligible: true,
    reason: LlamaCppAgentEligibilityReason.Eligible,
    requiredContextWindow: required,
    runtimeContextWindow: required,
    trainedContextWindow: required * 2,
    canIncreaseContextWindow: false,
  });

  expect(
    assessLlamaCppAgentEligibility({
      runtimeContextWindow: required + 1,
    }).eligible,
  ).toBe(true);
});

test('a runtime context below the requirement can be increased when training allows it', () => {
  expect(
    assessLlamaCppAgentEligibility({
      runtimeContextWindow: required - 1,
      trainedContextWindow: required,
    }),
  ).toEqual({
    eligible: false,
    reason: LlamaCppAgentEligibilityReason.RuntimeContextTooSmall,
    requiredContextWindow: required,
    runtimeContextWindow: required - 1,
    trainedContextWindow: required,
    canIncreaseContextWindow: true,
  });
});

test('a model trained below the requirement cannot reach eligibility by raising the runtime window', () => {
  expect(
    assessLlamaCppAgentEligibility({
      runtimeContextWindow: 4096,
      trainedContextWindow: required - 1,
    }),
  ).toEqual({
    eligible: false,
    reason: LlamaCppAgentEligibilityReason.TrainedContextTooSmall,
    requiredContextWindow: required,
    runtimeContextWindow: 4096,
    trainedContextWindow: required - 1,
    canIncreaseContextWindow: false,
  });
});

test('missing or non-positive context windows count as unknown', () => {
  expect(assessLlamaCppAgentEligibility({})).toEqual({
    eligible: false,
    reason: LlamaCppAgentEligibilityReason.RuntimeContextUnknown,
    requiredContextWindow: required,
    canIncreaseContextWindow: false,
  });

  for (const runtimeContextWindow of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = assessLlamaCppAgentEligibility({
      runtimeContextWindow,
      trainedContextWindow: 0,
    });
    expect(result.reason).toBe(LlamaCppAgentEligibilityReason.RuntimeContextUnknown);
    expect(result.runtimeContextWindow).toBeUndefined();
    expect(result.trainedContextWindow).toBeUndefined();
    expect(result.canIncreaseContextWindow).toBe(false);
  }
});

test('a custom requirement replaces the default minimum', () => {
  expect(
    assessLlamaCppAgentEligibility({
      runtimeContextWindow: 8192,
      requiredContextWindow: 8192,
    }),
  ).toMatchObject({
    eligible: true,
    reason: LlamaCppAgentEligibilityReason.Eligible,
    requiredContextWindow: 8192,
    runtimeContextWindow: 8192,
  });

  expect(
    assessLlamaCppAgentEligibility({
      runtimeContextWindow: 8192,
      requiredContextWindow: 0,
    }).requiredContextWindow,
  ).toBe(required);
});
