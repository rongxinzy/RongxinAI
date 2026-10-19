import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';

const root = path.resolve(__dirname, '..');

test('manual Linux gate delegates to shared packaging and installs its exact deb', () => {
  const workflow = readFileSync(
    path.join(root, '.github', 'workflows', 'linux-install-pr.yml'),
    'utf8',
  );

  assert.match(workflow, /workflow_call:/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /paths:/);
  assert.match(workflow, /extended-install-tests: true/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/build-inference-editions\.yml/);
  const shared = readFileSync(
    path.join(root, '.github/workflows/build-inference-editions.yml'),
    'utf8',
  );
  assert.match(shared, /bun run dist:linux/);
  assert.match(shared, /sudo apt-get install -y/);
  assert.match(shared, /realpath/);
  assert.match(shared, /electron-builder.json/);
  assert.match(shared, /verify-linux-renderer\.mjs/);
  assert.match(shared, /linux-deb-install-smoke\.png/);
  assert.match(shared, /actions\/upload-artifact@v6/);
});
