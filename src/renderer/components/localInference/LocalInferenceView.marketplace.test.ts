import { expect, test } from 'vitest';

test('marketplace page sizing defaults stay within supported range', async () => {
  const module = await import('./LocalInferenceView');
  const estimateMarketplacePageSize = (module as unknown as {
    __test__estimateMarketplacePageSize?: () => number;
  }).__test__estimateMarketplacePageSize;

  expect(typeof estimateMarketplacePageSize).toBe('function');
  if (!estimateMarketplacePageSize) return;

  const pageSize = estimateMarketplacePageSize();
  expect(pageSize).toBeGreaterThanOrEqual(6);
  expect(pageSize).toBeLessThanOrEqual(24);
});
