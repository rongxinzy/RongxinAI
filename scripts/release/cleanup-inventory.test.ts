import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';
import { afterEach, expect, test } from 'vitest';

import { isPreviousReleaseProtected, RETENTION_MS } from './cleanup-retention.mjs';

const temporaryDirectories: string[] = [];
const workflow = yaml.load(
  fs.readFileSync('.github/workflows/online-update-cleanup.yml', 'utf8'),
) as { jobs: { cleanup: { steps: Array<{ id?: string; run?: string }> } } };
const inventoryScript = workflow.jobs.cleanup.steps.find(step => step.id === 'inventory')!.run!;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function readInventory(options: { ageHours: number; missingKey?: string; invalidDate?: boolean }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-inventory-'));
  temporaryDirectories.push(directory);
  fs.mkdirSync(path.join(directory, 'bin'));
  fs.symlinkSync(path.resolve('scripts'), path.join(directory, 'scripts'), 'dir');
  const calls = path.join(directory, 'calls.jsonl');
  const output = path.join(directory, 'output');
  const objects = {
    'channels/stable-pointer.json': { schemaVersion: 1, generation: 'active' },
    'generations/active/legacy/stable.json': { manifests: [] },
    'channels/stable.previous-pointer.json': { schemaVersion: 1, generation: 'previous' },
    'generations/previous/legacy/stable.json': { manifests: [] },
  };
  const fixture = path.join(directory, 'fixture.json');
  fs.writeFileSync(
    fixture,
    JSON.stringify({
      objects,
      missingKey: options.missingKey,
      lastModified: options.invalidDate
        ? 'invalid'
        : new Date(Date.now() - options.ageHours * 3600000).toISOString(),
    }),
  );
  fs.writeFileSync(
    path.join(directory, 'bin', 'aws'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify(args) + '\\n');
const fixture = JSON.parse(fs.readFileSync(process.env.TEST_FIXTURE, 'utf8'));
const key = args[args.indexOf('--key') + 1];
if (args[1] === 'list-objects-v2') {
  console.log(JSON.stringify({ Contents: [], IsTruncated: false }));
} else if (key === fixture.missingKey || !(key in fixture.objects)) {
  console.error('An error occurred (NoSuchKey) when calling the GetObject operation');
  process.exit(255);
} else if (args[1] === 'head-object') {
  console.log(JSON.stringify({ LastModified: fixture.lastModified }));
} else if (args[1] === 'get-object') {
  fs.writeFileSync(args.at(-1), JSON.stringify(fixture.objects[key]));
} else {
  throw new Error('Unexpected AWS command: ' + args.join(' '));
}
`,
    { mode: 0o755 },
  );
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', inventoryScript], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      PATH: `${path.join(directory, 'bin')}${path.delimiter}${process.env.PATH}`,
      R2_BUCKET: 'test-only',
      GITHUB_OUTPUT: output,
      TEST_FIXTURE: fixture,
      TEST_CALLS: calls,
    },
  });
  return {
    ...result,
    output: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '',
    calls: fs.readFileSync(calls, 'utf8'),
  };
}

const previousKey = 'generations/previous/legacy/stable.json';

test('inventory succeeds when an expired previous generation has already been cleaned up', () => {
  const result = readInventory({ ageHours: 48, missingKey: previousKey });
  expect(result.status, result.stderr).toBe(0);
  expect(result.output).toContain('previous=false');
  expect(result.output).toContain('previous_generation=-');
  expect(result.calls).not.toContain(previousKey);
});

test('inventory still reads a previous generation during its protection window', () => {
  const result = readInventory({ ageHours: 1 });
  expect(result.status, result.stderr).toBe(0);
  expect(result.output).toContain('previous=true');
  expect(result.calls).toContain(previousKey);
});

test('inventory fails closed when a protected previous manifest is missing', () => {
  const result = readInventory({ ageHours: 1, missingKey: previousKey });
  expect(result.status).not.toBe(0);
  expect(result.calls).not.toContain('list-objects-v2');
});

test('inventory fails closed when the active manifest is missing', () => {
  const result = readInventory({
    ageHours: 48,
    missingKey: 'generations/active/legacy/stable.json',
  });
  expect(result.status).not.toBe(0);
  expect(result.calls).not.toContain('list-objects-v2');
});

test('inventory fails closed on invalid previous publication time', () => {
  const result = readInventory({ ageHours: 48, invalidDate: true });
  expect(result.status).not.toBe(0);
  expect(result.calls).not.toContain('list-objects-v2');
});

test('retention includes the exact 24-hour boundary and future timestamps', () => {
  const now = Date.parse('2026-10-31T00:00:00Z');
  for (const offset of [0, RETENTION_MS, RETENTION_MS + 1]) {
    const lastModified = new Date(now - RETENTION_MS + offset).toISOString();
    expect(isPreviousReleaseProtected({ LastModified: lastModified }, now)).toBe(true);
  }
  const expired = new Date(now - RETENTION_MS - 1).toISOString();
  expect(isPreviousReleaseProtected({ LastModified: expired }, now)).toBe(false);
});
