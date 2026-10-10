import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'tsup';

const enterpriseRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: { extension: path.resolve(enterpriseRoot, 'src/extension.ts') },
  format: ['cjs'],
  platform: 'node',
  target: 'node24',
  outDir: path.resolve(enterpriseRoot, 'dist'),
  outExtension: () => ({ js: '.cjs' }),
  clean: true,
  bundle: true,
  // The packaged extension is loaded from resources/zhiyuan-enterprise and
  // has no access to the application node_modules tree. Keep runtime ZIP
  // parsing self-contained alongside the SDK bundle.
  noExternal: ['@aep/sdk-node', 'yauzl'],
  external: ['electron'],
  splitting: false,
  sourcemap: true,
  minify: false,
  dts: false,
});
