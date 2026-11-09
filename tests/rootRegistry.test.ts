import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';

test('root packaging lock uses official npm tarballs without the failed mirror', () => {
  const lock = readFileSync('bun.lock', 'utf8');
  assert.ok(lock.includes('"lockfileVersion": 3'));
  assert.ok(lock.includes('https://registry.npmjs.org/'));
  assert.ok(!lock.includes('registry.npmmirror.com'));
});
