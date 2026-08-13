import { describe, expect, test } from 'vitest';

import { LlamaCppMemoryPolicy } from '../../../../shared/llamacpp';
import {
  clampMemoryBudgetPercent,
  LLAMACPP_MEMORY_BUDGET_PERCENT,
  resolveMemoryBudgetPercent,
  resolveMemoryPolicy,
} from './useLocalInferenceMemorySettings';

describe('local inference memory settings', () => {
  test('defaults an unset policy to automatic GPU layer placement', () => {
    expect(resolveMemoryPolicy({})).toBe(LlamaCppMemoryPolicy.Auto);
    expect(resolveMemoryPolicy({ memoryPolicy: LlamaCppMemoryPolicy.Manual })).toBe(
      LlamaCppMemoryPolicy.Manual,
    );
  });

  test('uses and bounds the manual memory percentage', () => {
    expect(resolveMemoryBudgetPercent({ memoryBudgetPercent: 50 })).toBe(50);
    expect(resolveMemoryBudgetPercent({ memoryBudgetPercent: 2 })).toBe(
      LLAMACPP_MEMORY_BUDGET_PERCENT.Min,
    );
    expect(resolveMemoryBudgetPercent({ memoryBudgetPercent: 99 })).toBe(
      LLAMACPP_MEMORY_BUDGET_PERCENT.Max,
    );
  });

  test('rounds slider input to its fixed increment', () => {
    expect(clampMemoryBudgetPercent(47)).toBe(45);
    expect(clampMemoryBudgetPercent(48)).toBe(50);
  });
});
