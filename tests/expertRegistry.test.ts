import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { upsertExpertRegistry } = require(
  '../SKILLs/zhiyuan-expert-manager/scripts/register_expert.js',
) as {
  upsertExpertRegistry: (options: {
    registryPath: string;
    entry: Record<string, unknown>;
    skipIfWithin?: string[];
  }) => void;
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const makeDir = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'expert-registry-'));
  temporaryDirectories.push(directory);
  return directory;
};

const entry = (name: string, dir: string): Record<string, unknown> => ({
  name,
  version: '1.0.0',
  expertType: 'agent',
  path: dir,
  agentIds: [name],
  piSyncedFiles: [],
  createdAt: '2026-08-18T00:00:00.000Z',
});

const readRegistry = (registryPath: string): Array<Record<string, unknown>> => {
  if (!fs.existsSync(registryPath)) return [];
  return JSON.parse(fs.readFileSync(registryPath, 'utf-8')).packages;
};

test('records a user package inside the skipped root boundary', () => {
  const root = makeDir();
  const registryPath = path.join(root, 'registry.json');
  const packageDir = path.join(root, 'my-expert');

  upsertExpertRegistry({
    registryPath,
    entry: entry('my-expert', packageDir),
    skipIfWithin: [path.join(root, 'SKILLs')],
  });

  const packages = readRegistry(registryPath);
  expect(packages).toHaveLength(1);
  expect(packages[0].name).toBe('my-expert');
});

test('never records an entry inside a skipped root and cleans stale ones', () => {
  const root = makeDir();
  const bundledRoot = path.join(root, 'SKILLs');
  const bundledPreset = path.join(bundledRoot, 'zhiyuan-expert-manager', 'presets', 'data-analyst');
  const userPackage = path.join(root, 'user-expert');
  const registryPath = path.join(root, 'registry.json');

  // Pre-existing dirty state: a bundled record written before the fix plus a
  // user package. The next upsert must drop the bundled one idempotently.
  fs.writeFileSync(
    registryPath,
    JSON.stringify({
      packages: [
        entry('data-analyst', bundledPreset),
        entry('user-expert', userPackage),
      ],
    }),
  );

  upsertExpertRegistry({
    registryPath,
    entry: entry('user-expert', userPackage),
    skipIfWithin: [bundledRoot],
  });

  const packages = readRegistry(registryPath);
  expect(packages.map(p => p.name)).toEqual(['user-expert']);
});

test('same-name upsert replaces the previous user entry (upgrade semantics)', () => {
  const root = makeDir();
  const firstDir = path.join(root, 'v1');
  const secondDir = path.join(root, 'v2');
  const registryPath = path.join(root, 'registry.json');

  upsertExpertRegistry({ registryPath, entry: entry('expert', firstDir) });
  upsertExpertRegistry({ registryPath, entry: entry('expert', secondDir) });

  const packages = readRegistry(registryPath);
  expect(packages).toHaveLength(1);
  expect(packages[0].path).toBe(secondDir);
});

test('rejects only real containment, not prefix look-alikes', () => {
  const root = makeDir();
  const bundledRoot = path.join(root, 'SKILLs');
  const lookAlike = path.join(root, 'SKILLs-copy');
  const registryPath = path.join(root, 'registry.json');

  upsertExpertRegistry({
    registryPath,
    entry: entry('look-alike', lookAlike),
    skipIfWithin: [bundledRoot],
  });

  const packages = readRegistry(registryPath);
  expect(packages.map(p => p.name)).toEqual(['look-alike']);
});
