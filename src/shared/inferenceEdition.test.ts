import { describe, expect, test } from 'vitest';

import {
  InferenceEdition,
  isLocalInferenceEnabledForEdition,
  normalizeInferenceEdition,
} from './inferenceEdition';

describe('inferenceEdition', () => {
  test('normalizes update variants', () => {
    expect(normalizeInferenceEdition('cpu')).toBe(InferenceEdition.Cpu);
    expect(normalizeInferenceEdition('CUDA')).toBe(InferenceEdition.Cuda);
    expect(normalizeInferenceEdition(undefined)).toBe(InferenceEdition.Lite);
  });

  test('lite disables local inference', () => {
    expect(isLocalInferenceEnabledForEdition(InferenceEdition.Lite)).toBe(false);
    expect(isLocalInferenceEnabledForEdition(InferenceEdition.Cpu)).toBe(true);
  });
});
