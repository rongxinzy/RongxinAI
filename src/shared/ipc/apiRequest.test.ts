import { describe, expect, test } from 'vitest';

import { ApiRequestPurpose, shouldRecordApiRequest } from './apiRequest';

describe('api request recording policy', () => {
  test('does not record connectivity tests', () => {
    expect(shouldRecordApiRequest(ApiRequestPurpose.ConnectivityTest)).toBe(false);
  });

  test('records requests without a purpose', () => {
    expect(shouldRecordApiRequest()).toBe(true);
  });
});
