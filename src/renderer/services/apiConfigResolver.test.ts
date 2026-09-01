import { expect, test } from 'vitest';

import { providerRequiresApiKey } from './apiConfigResolver';

test('custom providers do not require an API key', () => {
  expect(providerRequiresApiKey('custom_0')).toBe(false);
});

test('built-in remote providers still require an API key', () => {
  expect(providerRequiresApiKey('openai')).toBe(true);
});
