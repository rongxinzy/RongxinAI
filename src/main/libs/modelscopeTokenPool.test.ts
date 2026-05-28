import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test } from 'vitest';

import { createModelScopeTokenPool } from './modelscopeTokenPool';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelscope-token-pool-'));
  tempDirs.push(dir);
  return dir;
}

test('createModelScopeTokenPool reads comma-separated env tokens and rotates them', () => {
  const pool = createModelScopeTokenPool({
    env: { MODELSCOPE_TOKENS: 'one, two, one' },
    cwd: createTempDir(),
  });

  expect(pool.size()).toBe(2);
  expect(pool.nextToken()).toBe('one');
  expect(pool.nextToken()).toBe('two');
  expect(pool.nextToken()).toBe('one');
});

test('createModelScopeTokenPool reads generated resource tokens', () => {
  const cwd = createTempDir();
  fs.writeFileSync(
    path.join(cwd, 'modelscope.tokens.local.json'),
    JSON.stringify({ tokens: ['resource-token'] }),
    'utf-8',
  );

  const pool = createModelScopeTokenPool({ env: {}, cwd });

  expect(pool.size()).toBe(1);
  expect(pool.nextToken()).toBe('resource-token');
});

test('createModelScopeTokenPool reads local dotenv tokens', () => {
  const cwd = createTempDir();
  fs.writeFileSync(
    path.join(cwd, '.env'),
    'MODELSCOPE_TOKENS="env-file-one,env-file-two"\n',
    'utf-8',
  );

  const pool = createModelScopeTokenPool({ env: {}, cwd });

  expect(pool.size()).toBe(2);
  expect(pool.nextToken()).toBe('env-file-one');
  expect(pool.nextToken()).toBe('env-file-two');
});
