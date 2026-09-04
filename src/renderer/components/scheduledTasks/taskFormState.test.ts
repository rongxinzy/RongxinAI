import { describe, expect, test } from 'vitest';

import { createFormState } from './taskFormState';

describe('createFormState', () => {
  test('defaults a blank task to a daily schedule', () => {
    expect(createFormState().planType).toBe('daily');
  });
});
