/**
 * CLI wrapper for preload ↔ IElectronAPI verification (implemented in generate-browser-mock.ts).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const generator = path.join(ROOT, 'scripts/preview/generate-browser-mock.ts');
const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--experimental-detect-module', generator, '--verify-preload'],
  { cwd: ROOT, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
