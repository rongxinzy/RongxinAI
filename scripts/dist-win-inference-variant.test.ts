import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';
import { packageCommands } from './packaging/package-commands.mjs';

const root = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

test('Windows dist scripts preserve ZHIYUAN_UPDATE_VARIANT for each inference edition', () => {
  for (const name of [
    'dist:win:offline',
    'dist:win:signed',
    'dist:win:cpu',
    'dist:win:cuda',
    'dist:win:signed:cpu',
    'dist:win:signed:cuda',
  ])
    expect(packageJson.scripts[name]).toBe(`bun scripts/packaging/run-package.mjs ${name}`);
  const offline = packageCommands['dist:win:offline'];
  expect(packageJson.scripts['dist:win:offline']).toBe(
    'bun scripts/packaging/run-package.mjs dist:win:offline',
  );
  expect(offline).not.toMatch(/ZHIYUAN_UPDATE_VARIANT=lite/);
  expect(offline).toContain('node scripts/ensure-build-version.js');

  expect(packageCommands['dist:win:cpu']).toMatch(
    /ZHIYUAN_UPDATE_VARIANT=cpu[\s\S]*dist:win:offline/,
  );
  expect(packageCommands['dist:win:cuda']).toMatch(
    /ZHIYUAN_UPDATE_VARIANT=cuda[\s\S]*dist:win:offline/,
  );
  expect(packageJson.scripts['dist:win:lite']).toContain('dist:win:offline');

  const signed = packageCommands['dist:win:signed'];
  expect(packageJson.scripts['dist:win:signed']).toBe(
    'bun scripts/packaging/run-package.mjs dist:win:signed',
  );
  expect(signed).not.toMatch(/ZHIYUAN_UPDATE_VARIANT=lite/);
  expect(signed).toContain('node scripts/ensure-build-version.js');
  expect(packageCommands['dist:win:signed:cpu']).toMatch(
    /ZHIYUAN_UPDATE_VARIANT=cpu[\s\S]*dist:win:signed/,
  );
  expect(packageCommands['dist:win:signed:cuda']).toMatch(
    /ZHIYUAN_UPDATE_VARIANT=cuda[\s\S]*dist:win:signed/,
  );
});
