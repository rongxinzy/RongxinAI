import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// The complete suite remains available through test:full in release preflight.
// These tests require real downloaded runtimes rather than the Electron mock.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: ['**/*.integration.test.ts', 'scripts/electron-native-abi.test.ts'],
    },
  }),
);
