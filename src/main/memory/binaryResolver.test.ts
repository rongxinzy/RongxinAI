import path from 'path';
import { expect, test } from 'vitest';

import { EngramEnvironment } from './constants';
import { resolveEngramBinary } from './binaryResolver';

test('explicit runtime path takes precedence over packaged and development paths', () => {
  const explicit = path.resolve('custom', 'engram.exe');
  const resolved = resolveEngramBinary({
    env: { [EngramEnvironment.BinaryPath]: explicit },
    platform: 'win32',
    resourcesPath: path.resolve('resources'),
    projectRoot: path.resolve('project'),
    fileExists: () => true,
  });

  expect(resolved).toBe(explicit);
});

test('returns null when no managed runtime exists', () => {
  expect(
    resolveEngramBinary({
      env: {},
      platform: 'linux',
      resourcesPath: '/app/resources',
      projectRoot: '/workspace',
      fileExists: () => false,
    }),
  ).toBeNull();
});
