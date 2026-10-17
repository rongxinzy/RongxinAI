import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

test('Windows dist scripts preserve ZHIYUAN_UPDATE_VARIANT for each inference edition', () => {
  const offline = packageJson.scripts['dist:win:offline'];
  expect(offline).not.toMatch(/ZHIYUAN_UPDATE_VARIANT=lite/);
  expect(offline).toContain('node scripts/ensure-build-version.js');

  expect(packageJson.scripts['dist:win:cpu']).toMatch(
    /ZHIYUAN_UPDATE_VARIANT=cpu[\s\S]*dist:win:offline/,
  );
  expect(packageJson.scripts['dist:win:cuda']).toMatch(
    /ZHIYUAN_UPDATE_VARIANT=cuda[\s\S]*dist:win:offline/,
  );
  expect(packageJson.scripts['dist:win:lite']).toContain('dist:win:offline');
});
