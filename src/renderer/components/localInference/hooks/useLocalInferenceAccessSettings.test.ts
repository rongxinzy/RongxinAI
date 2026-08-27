import { expect, test } from 'vitest';

import { buildAccessSettingsConfig } from './useLocalInferenceAccessSettings';

test('preserves the model library directory when applying access settings', () => {
  expect(
    buildAccessSettingsConfig(
      {
        modelsDir: 'D:\\models',
        port: '8080',
        ctxSize: '4096',
      },
      true,
      '8080',
      false,
    ),
  ).toEqual({
    modelsDir: 'D:\\models',
    port: '8080',
    ctxSize: '4096',
    listenHost: '0.0.0.0',
    keepRunningOnAppQuit: false,
  });
});
