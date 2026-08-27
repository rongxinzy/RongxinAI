import { expect, test } from 'vitest';

import {
  createLlamaCppServerSpawnOptions,
  shouldKeepLlamaCppServiceRunning,
} from './llamacppProcessLifecycle';

test('keeps local inference services running after app quit by default', () => {
  expect(shouldKeepLlamaCppServiceRunning({})).toBe(true);
  expect(
    createLlamaCppServerSpawnOptions({
      config: {},
      env: { PATH: 'test-path' },
    }),
  ).toEqual({
    detached: true,
    stdio: 'ignore',
    env: { PATH: 'test-path' },
    windowsHide: true,
  });
});

test('keeps the managed process attached when persistence is disabled', () => {
  expect(shouldKeepLlamaCppServiceRunning({ keepRunningOnAppQuit: false })).toBe(false);
  expect(
    createLlamaCppServerSpawnOptions({
      config: { keepRunningOnAppQuit: false },
      env: { PATH: 'test-path' },
    }),
  ).toEqual({
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: 'test-path' },
    windowsHide: true,
  });
});
