#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = resolve(root, 'src/renderer/browserMock/fixtures/streamReplay');

const runCodegen = (): void => {
  execFileSync('bunx', ['vitest', 'run', 'tests/streamReplayFixture.codegen.test.ts'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env },
  });
};

const fingerprint = (): string => {
  const files = readdirSync(fixtureDir)
    .filter(name => name.endsWith('.json'))
    .sort();
  const hash = createHash('sha256');
  for (const name of files) {
    hash.update(name);
    hash.update(readFileSync(resolve(fixtureDir, name)));
  }
  return hash.digest('hex');
};

const check = process.argv.includes('--check');
if (check) {
  const before = fingerprint();
  runCodegen();
  const after = fingerprint();
  if (before !== after) {
    console.error('[web:preview:stream-replay:codegen:check] stream replay fixtures are stale');
    process.exit(1);
  }
  console.log('[web:preview:stream-replay:codegen:check] ok');
} else {
  runCodegen();
  console.log(`[web:preview:stream-replay:codegen] wrote fixtures to ${fixtureDir}`);
}
