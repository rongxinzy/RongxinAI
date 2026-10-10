import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const enterpriseRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(enterpriseRoot, 'src/ui'),
  base: './',
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(enterpriseRoot, 'src/ui'),
    },
  },
  build: {
    outDir: path.resolve(enterpriseRoot, 'dist/ui'),
    emptyOutDir: false,
    sourcemap: true,
    target: 'chrome130',
  },
});
