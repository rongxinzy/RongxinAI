import { expect, test } from 'vitest';

import { resolveMarketplaceParameterCount } from './marketplaceModelOrder';

test('resolves catalogue parameter counts in billions without parsing device tiers', () => {
  expect(resolveMarketplaceParameterCount({ parameterCount: 0.5 })).toBe(0.5);
  expect(resolveMarketplaceParameterCount({ parameterCount: 8 })).toBe(8);
  expect(resolveMarketplaceParameterCount({})).toBeNull();
});
