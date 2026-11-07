import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('recorded GitHub Actions job REST fixture omits outputs (per official schema)', () => {
  const job = JSON.parse(
    readFileSync('scripts/ci/gates/fixtures/github-rest-actions-job-200.json', 'utf8'),
  ) as Record<string, unknown>;
  expect(job).toHaveProperty('steps');
  expect(job).toHaveProperty('conclusion');
  expect(job).not.toHaveProperty('outputs');
});
