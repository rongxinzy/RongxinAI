import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
      '@': path.resolve(__dirname, './src/renderer'),
      electron: path.resolve(__dirname, './tests/__mocks__/electron.ts'),
    },
  },
  test: {
    include: ['scripts/preview/recordStreamReplayFixtures.codegen.test.ts'],
    environment: 'node',
    setupFiles: ['./tests/setup/jsdom.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    server: {
      deps: {
        inline: ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai'],
      },
    },
  },
  ssr: {
    noExternal: ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai'],
  },
});
