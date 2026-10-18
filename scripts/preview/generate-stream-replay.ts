#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = resolve(root, 'src/renderer/browserMock/fixtures/streamReplay');

const listJsonFiles = (dir: string): string[] =>
  readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .sort();

const readFixtureMap = (dir: string): Map<string, string> => {
  const map = new Map<string, string>();
  for (const name of listJsonFiles(dir)) {
    map.set(name, readFileSync(join(dir, name), 'utf8'));
  }
  return map;
};

const formatFixtureJsonInDir = (dir: string): void => {
  const names = listJsonFiles(dir);
  if (names.length === 0) return;
  execFileSync('bunx', ['oxfmt', ...names.map(name => join(dir, name))], {
    cwd: root,
    stdio: 'pipe',
  });
};

const runCodegenTo = (outDir: string): void => {
  execFileSync('bun', ['x', 'vitest', 'run', '-c', 'vitest.stream-replay-codegen.config.ts'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      STREAM_REPLAY_FIXTURE_OUT_DIR: outDir,
    },
  });
};

const check = process.argv.includes('--check');
if (check) {
  const tempDir = mkdtempSync(join(tmpdir(), 'stream-replay-codegen-'));
  try {
    runCodegenTo(tempDir);
    formatFixtureJsonInDir(tempDir);
    formatFixtureJsonInDir(fixtureDir);
    const expected = readFixtureMap(fixtureDir);
    const actual = readFixtureMap(tempDir);
    const missing = [...expected.keys()].filter(name => !actual.has(name));
    const extra = [...actual.keys()].filter(name => !expected.has(name));
    const changed = [...expected.keys()].filter(
      name => actual.has(name) && actual.get(name) !== expected.get(name),
    );
    if (missing.length > 0 || extra.length > 0 || changed.length > 0) {
      console.error('[web:preview:stream-replay:codegen:check] stream replay fixtures are stale');
      if (missing.length > 0) console.error('missing:', missing.join(', '));
      if (extra.length > 0) console.error('extra:', extra.join(', '));
      if (changed.length > 0) console.error('changed:', changed.join(', '));
      process.exit(1);
    }
    console.log('[web:preview:stream-replay:codegen:check] ok');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
} else {
  runCodegenTo(fixtureDir);
  formatFixtureJsonInDir(fixtureDir);
  console.log(`[web:preview:stream-replay:codegen] ok (${fixtureDir})`);
}
