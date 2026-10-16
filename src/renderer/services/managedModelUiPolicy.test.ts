import { describe, expect, test } from 'vitest';

import { shouldShowLocalInferenceNavigation } from './managedModelUiPolicy';

describe('managed model UI policy', () => {
  test('hides local inference navigation only for exclusive managed models', () => {
    expect(shouldShowLocalInferenceNavigation(false, true)).toBe(false);
    expect(shouldShowLocalInferenceNavigation(false, false)).toBe(true);
    expect(shouldShowLocalInferenceNavigation(true, false)).toBe(false);
  });
});
