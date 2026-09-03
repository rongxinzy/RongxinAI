import react from '@vitejs/plugin-react';
import babel from '../tooling/node_modules/@rolldown/plugin-babel/dist/index.mjs';
import path from 'node:path';
import { defineConfig } from 'vite';

import reactCompiler from '../tooling/node_modules/babel-plugin-react-compiler/dist/index.js';

const benchmarkRoot = path.resolve(__dirname);
const compilerEnabled = process.env.REACT_COMPILER_EVALUATION === 'enabled';
const outputDirectory = process.env.REACT_COMPILER_EVALUATION_OUT_DIR ?? 'dist';

export default defineConfig({
  root: benchmarkRoot,
  base: './',
  plugins: [
    react(),
    ...(compilerEnabled
      ? [babel({ plugins: [[reactCompiler, { compilationMode: 'annotation' }]] })]
      : []),
  ],
  build: {
    emptyOutDir: true,
    outDir: path.resolve(benchmarkRoot, outputDirectory),
    target: 'chrome130',
  },
});
