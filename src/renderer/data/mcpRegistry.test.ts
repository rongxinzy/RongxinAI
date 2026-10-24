import { expect, test } from 'vitest';

import registryBundle from './mcpRegistry.json';
import { mcpCategories, mcpRegistry } from './mcpRegistry';

test('mcpRegistry.ts mirrors mcpRegistry.json servers and categories', () => {
  expect(mcpRegistry.map(entry => entry.id)).toEqual(
    registryBundle.servers.map(server => server.id),
  );
  expect(mcpCategories.map(category => category.id)).toEqual(
    registryBundle.categories.map(category => category.id),
  );
  expect(mcpRegistry.length).toBeGreaterThanOrEqual(20);
});
