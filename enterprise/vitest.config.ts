import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const enterpriseRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(enterpriseRoot, 'src/ui'),
    },
  },
  test: {
    root: enterpriseRoot,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mjs'],
    // jsdom-driven renderer integration tests run well past the 5s default
    // once coverage instrumentation slows rendering; the ceiling only bounds
    // hangs, fast suites are unaffected.
    testTimeout: 30_000,
    // Coverage gate: the suite must hold the project floor. thresholds at
    // the config level keep local `vitest --coverage` honest too.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/ui/components/ui/**'],
      // Lines is the primary coverage metric for TS (statements is a Go
      // convention); branches/functions hold secondary floors.
      thresholds: { lines: 80, branches: 60, functions: 70 },
    },
  },
});
