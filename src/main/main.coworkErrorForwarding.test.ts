import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./main.ts', import.meta.url)), 'utf8');

test('sends structured errors from asynchronous Cowork fallbacks', () => {
  const fallbackCalls = source.match(/error: classifyCoworkError\(errorMessage\)/g);

  expect(fallbackCalls).toHaveLength(2);
  expect(source).not.toMatch(/CoworkStreamIpc\.Error,[\s\S]{0,160}error: errorMessage/);
});
