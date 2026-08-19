import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';

const root = path.resolve(__dirname, '..');

test('development startup externalizes package subpaths without redundant delays or compilation', () => {
  const viteConfig = readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const developmentScript = packageJson.scripts?.['electron:dev'] || '';

  assert.match(viteConfig, /extractExternalDeps\(packageJson, true\)/);
  assert.match(viteConfig, /electronDevelopmentExternalRoots\.has\(packageRoot\(id\)\)/);
  assert.match(viteConfig, /command === ['"]serve['"][\s\S]*isElectronDevelopmentExternal/);
  assert.doesNotMatch(developmentScript, /-d 20000/);
  assert.doesNotMatch(developmentScript, /compile:electron/);
  assert.match(developmentScript, /dist-electron\/\.electron-ready/);
});
