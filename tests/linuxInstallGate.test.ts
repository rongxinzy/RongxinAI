import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';

const root = path.resolve(__dirname, '..');

test('selected pull requests install and start the generated Ubuntu package', () => {
  const workflow = readFileSync(
    path.join(root, '.github', 'workflows', 'linux-install-pr.yml'),
    'utf8',
  );

  assert.match(workflow, /workflow_call:/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /paths:/);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(
    workflow,
    /uses: \.\/\.github\/actions\/build-inference-packages\s+with:\s+mode: verify\s+platform: linux\s+runtime-target: linux-x64\s+inference-edition: lite/,
  );
  assert.doesNotMatch(workflow, /bun run dist:linux/);

  const packageJson = readFileSync(path.join(root, 'package.json'), 'utf8');
  assert.match(packageJson, /"predist:linux": "[^"]*rebuild:electron-native:linux-packaging/);
  assert.match(packageJson, /"predist:linux": "[^"]*engram:runtime:linux-x64/);
  assert.doesNotMatch(packageJson, /"dist:linux": "[^"]*engram:runtime:linux-x64/);
  assert.doesNotMatch(workflow, /engram:runtime:linux-x64/);
  const build = workflow.indexOf('uses: ./.github/actions/build-inference-packages');
  const smoke = workflow.indexOf('node scripts/ci/linux-release-acceptance.mjs smoke-deb');
  assert.ok(smoke > build);
  assert.match(workflow, /linux-deb-install-smoke\.png/);
  assert.match(workflow, /actions\/upload-artifact@v6/);
});
