import { describe, expect, it } from 'vitest';
import { formatMagpieManagementError } from './managementErrors';

describe('formatMagpieManagementError', () => {
  it('surfaces upstream JSON error fields', () => {
    expect(
      formatMagpieManagementError(400, 'Bad Request', JSON.stringify({ error: 'no_models' })),
    ).toBe('no_models');
  });
});
