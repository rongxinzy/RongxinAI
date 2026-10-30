import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';

const lock = JSON.parse(
  readFileSync(new URL('../SKILLs/web-search/package-lock.json', import.meta.url), 'utf8'),
) as { packages: Record<string, { version?: string; dependencies?: Record<string, string> }> };

test.each([
  ['express', [4, 22, 3]],
  ['body-parser', [1, 20, 9]],
  ['proxy-addr', [2, 0, 8]],
  ['qs', [6, 16, 2]],
] as const)('web-search locks a patched compatible %s', (name, minimum) => {
  const version = lock.packages[`node_modules/${name}`]?.version;
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  const actual = version!.split('.').map(Number);
  expect(actual[0]).toBe(minimum[0]);
  expect(actual[1] > minimum[1] || (actual[1] === minimum[1] && actual[2] >= minimum[2])).toBe(
    true,
  );
});
