import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';

import { assertModelCatalog } from './assert-model-catalog.cjs';

test('the packaged seed has at least 100 models and fits the 100 MB budget', () => {
  const { count, bytes } = assertModelCatalog(path.resolve('resources/model-catalog.sqlite'));
  expect(count).toBeGreaterThanOrEqual(100);
  expect(bytes).toBeLessThanOrEqual(100_000_000);
});

test('packaging rejects an undersized catalog and an oversized resource', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'catalog-package-limits-'));
  const file = path.join(dir, 'catalog.sqlite');
  try {
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE catalog_models (repo_id TEXT PRIMARY KEY)');
    db.close();
    expect(() => assertModelCatalog(file)).toThrow('at least 100 repositories');

    writeFileSync(file, '');
    truncateSync(file, 100_000_001);
    expect(() => assertModelCatalog(file)).toThrow('exceeds 100 MB');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
