import path from 'path';

import { expect, test } from 'vitest';

import { mergeMcpSpawnEnv } from './mcpEnvironment';

test('preserves inherited commands when managed runtimes add PATH entries', () => {
  const inheritedBin = path.join('home', 'user', '.local', 'bin');
  const managedPython = path.join('app-data', 'runtimes', 'python');

  const merged = mergeMcpSpawnEnv(
    { PATH: [inheritedBin, path.join('system', 'bin')].join(path.delimiter), HOME: 'home' },
    { PATH: managedPython, ZHIYUAN_PYTHON_ROOT: managedPython },
  );

  expect(merged.PATH.split(path.delimiter)).toEqual([
    managedPython,
    inheritedBin,
    path.join('system', 'bin'),
  ]);
  expect(merged.HOME).toBe('home');
  expect(merged.ZHIYUAN_PYTHON_ROOT).toBe(managedPython);
});

test('deduplicates PATH entries while keeping resolved runtime paths first', () => {
  const runtimeBin = path.join('runtime', 'bin');
  const systemBin = path.join('system', 'bin');

  const merged = mergeMcpSpawnEnv(
    { PATH: [runtimeBin, systemBin].join(path.delimiter) },
    { PATH: runtimeBin },
  );

  expect(merged.PATH.split(path.delimiter)).toEqual([runtimeBin, systemBin]);
});

test.runIf(process.platform === 'win32')(
  'prefers an explicitly prepared PATH over inherited Path',
  () => {
    const preparedBin = path.join('prepared', 'bin');
    const staleBin = path.join('stale', 'bin');

    const merged = mergeMcpSpawnEnv({ Path: staleBin, PATH: preparedBin }, undefined);

    expect(merged.PATH).toBe(preparedBin);
    expect(merged).not.toHaveProperty('Path');
  },
);
