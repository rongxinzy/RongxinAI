#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = resolve(root, 'src/renderer/browserMock/fixtures/streamReplay');
const fingerprintPath = resolve(fixtureDir, '.fingerprint');

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

const runCodegen = (): void => {
  execFileSync('bun', ['x', 'vitest', 'run', '-c', 'vitest.stream-replay-codegen.config.ts'], {
    cwd: root,
    stdio: 'inherit',
  });
  writeFileSync(fingerprintPath, `${fingerprint()}\n`, 'utf8');
};

const check = process.argv.includes('--check');
if (check) {
  const expected = readFileSync(fingerprintPath, 'utf8').trim();
  const actual = fingerprint();
  if (expected !== actual) {
    console.error('[web:preview:stream-replay:codegen:check] stream replay fixtures are stale');
    console.error(`expected fingerprint ${expected}`);
    console.error(`actual fingerprint   ${actual}`);
    process.exit(1);
  }
  console.log('[web:preview:stream-replay:codegen:check] ok');
} else {
  runCodegen();
  console.log(`[web:preview:stream-replay:codegen] ok (${fixtureDir})`);
}
