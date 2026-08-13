import { describe, expect, test } from 'vitest';

import { normalizeSingleExpertIds } from './sessionExperts';

describe('normalizeSingleExpertIds', () => {
  test('normalizes a single expert ID', () => {
    expect(normalizeSingleExpertIds([' expert-a ', 'expert-a'])).toEqual(['expert-a']);
  });

  test('rejects multiple unique experts', () => {
    expect(() => normalizeSingleExpertIds(['expert-a', 'expert-b'])).toThrow(
      'Only one expert can be used for a session turn',
    );
  });
});
