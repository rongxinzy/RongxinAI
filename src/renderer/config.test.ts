import { expect, test } from 'vitest';
import { defaultConfig } from './config';
test('ordinary settings contain no provider catalog, credentials or default model', () => {
  for (const key of ['providers', 'api', 'model']) expect(defaultConfig).not.toHaveProperty(key);
});
