import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';

test('web-search build tarballs use the official registry with locked integrity', () => {
  const lock = JSON.parse(readFileSync('SKILLs/web-search/package-lock.json', 'utf8')) as {
    packages: Record<string, { resolved?: string; integrity?: string }>;
  };
  let tarballs = 0;
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!entry.resolved) continue;
    assert.equal(new URL(entry.resolved).origin, 'https://registry.npmjs.org', name);
    assert.match(entry.integrity ?? '', /^sha512-/, name);
    tarballs += 1;
  }
  assert.ok(tarballs > 0);
});
