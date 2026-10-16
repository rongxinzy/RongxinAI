import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import path from 'path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const devPort = Number(process.env.VITE_DEV_PORT ?? 5176);

/**
 * Browser preview configuration.
 * Skips Electron plugins and runs a plain Vite dev server.
 */
export default defineConfig(async () => ({
  define: {
    __VERSION__: JSON.stringify('0.16.0'),
  },
  plugins: [
    (await import('@tailwindcss/vite')).default(),
    react(),
    babel({
      presets: [reactCompilerPreset({ compilationMode: 'annotation' })],
    }),
  ],
  base: '/',
  resolve: {
    alias: {
      '@shared': path.resolve(projectRoot, './src/shared'),
      '@': path.resolve(projectRoot, './src/renderer'),
    },
  },
  build: {
    outDir: 'dist-browser',
    emptyOutDir: true,
    sourcemap: true,
    rolldownOptions: {
      input: {
        main: path.resolve(projectRoot, 'index.html'),
      },
    },
  },
  server: {
    port: devPort,
    strictPort: false,
    host: true,
    hmr: {
      port: devPort,
    },
  },
  optimizeDeps: {
    entries: ['src/renderer/main.tsx'],
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-redux',
      'react/jsx-dev-runtime',
      'react/jsx-runtime',
    ],
  },
  clearScreen: false,
}));
