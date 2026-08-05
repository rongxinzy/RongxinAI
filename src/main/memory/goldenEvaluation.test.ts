import { expect, test } from 'vitest';

import { evaluateMemoryGoldenRuns, type MemoryGoldenRunResult } from './goldenEvaluation';

const goldenRuns: MemoryGoldenRunResult[] = [
  {
    id: 'project-isolation',
    expectedRecallIds: ['project-a'],
    actualRecallIds: ['project-a'],
    contextTokens: 120,
    totalPromptTokens: 1_200,
    userCorrected: false,
    forgetRequested: false,
    forgetPropagated: false,
    sideEffectKeys: ['save:project-a'],
  },
  {
    id: 'superseded-decision',
    expectedRecallIds: ['decision-new'],
    actualRecallIds: ['decision-new', 'unrelated'],
    expectedConflictWinner: 'decision-new',
    actualConflictWinner: 'decision-new',
    contextTokens: 180,
    totalPromptTokens: 1_800,
    userCorrected: true,
    forgetRequested: false,
    forgetPropagated: false,
    sideEffectKeys: ['save:decision-new', 'save:decision-new'],
  },
  {
    id: 'forget-propagation',
    expectedRecallIds: [],
    actualRecallIds: [],
    contextTokens: 0,
    totalPromptTokens: 1_000,
    userCorrected: false,
    forgetRequested: true,
    forgetPropagated: true,
    sideEffectKeys: ['forget:decision-old'],
  },
];

test('computes the seven issue 161 golden evaluation metrics', () => {
  expect(evaluateMemoryGoldenRuns(goldenRuns)).toEqual({
    correctRecallRate: 1,
    wrongRecallRate: 1 / 3,
    conflictResolutionRate: 1,
    tokenShare: 0.075,
    userCorrectionRate: 1 / 3,
    forgetPropagationRate: 1,
    duplicateSideEffectRate: 1 / 4,
  });
});
