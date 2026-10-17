import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('preload.ts matches IElectronAPI and browser mock codegen is current', () => {
  execFileSync('bun', ['run', 'web:preview:contract'], { cwd: root, stdio: 'pipe' });
  execFileSync(
    'node',
    [
      '--experimental-strip-types',
      '--experimental-detect-module',
      path.join(root, 'scripts/preview/generate-browser-mock.ts'),
      '--check',
    ],
    { cwd: root, stdio: 'pipe' },
  );
});
