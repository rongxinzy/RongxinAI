import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';

const root = path.resolve(__dirname, '..');

test('every pull request installs and starts the generated Ubuntu package', () => {
  const workflow = readFileSync(
    path.join(root, '.github', 'workflows', 'linux-install-pr.yml'),
    'utf8',
  );

  assert.match(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /paths:/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /bun run dist:linux/);
  assert.match(workflow, /sudo apt-get install -y/);
  assert.match(workflow, /realpath/);
  assert.match(workflow, /'\/opt\/知远\/知远'/);
  assert.match(workflow, /verify-linux-renderer\.mjs/);
  assert.match(workflow, /linux-deb-install-smoke\.png/);
  assert.match(workflow, /actions\/upload-artifact@v6/);
});
