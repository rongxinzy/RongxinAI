import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

import { RELEASE_PLATFORM_STAGES } from '../release/release-platform-stages.mjs';

const releaseWorkflow = readFileSync(
  path.join(process.cwd(), '.github/workflows/release.yml'),
  'utf8',
);

test('release builds platforms independently and publishes one complete generation', () => {
  expect(releaseWorkflow).not.toMatch(/ZHIYUAN_RELEASE_PLATFORMS/);
  expect(releaseWorkflow).toContain('build-windows:');
  expect(releaseWorkflow).toContain('build-macos:');
  expect(releaseWorkflow).toContain('build-linux:');
  expect(releaseWorkflow).toContain('build-kylin:');
  expect(releaseWorkflow).toContain(
    'needs: [prepare-release, build-windows, build-macos, build-linux, build-kylin]',
  );
  expect(releaseWorkflow).not.toContain('publish-windows:');
  expect(releaseWorkflow).not.toContain('publish-macos:');
  expect(releaseWorkflow).not.toContain('publish-linux:');
  expect(releaseWorkflow).toContain('fail-fast: false');
  expect(releaseWorkflow).toContain('build-windows-release.yml');
  expect(releaseWorkflow).toContain('collect-github-release-assets.mjs');
  expect(releaseWorkflow).toContain('upload-release-candidate.mjs');
  expect(releaseWorkflow).toContain('kylin-v11-x64-rpm');
  expect(RELEASE_PLATFORM_STAGES).toEqual(['win32', 'darwin', 'linux']);
});

test('Kylin package builds on a native Kylin V11 x64 runner with Chinese defaults', () => {
  const workflow = readFileSync(
    path.join(process.cwd(), '.github/workflows/build-kylin-release.yml'),
    'utf8',
  );
  expect(workflow).toContain('runs-on: ${{ fromJSON(inputs.runner-labels) }}');
  expect(workflow).toContain('workflow_dispatch:');
  expect(workflow).toContain('${ID:-}" == "kylin"');
  expect(workflow).toContain('ZHIYUAN_DEFAULT_LOCALE: zh-CN');
  expect(workflow).toContain('bun run dist:kylin:x64');
  expect(workflow).toContain('rpm -qip');
  expect(workflow).toContain('name: kylin-v11-x64-rpm');
});

test('build inference editions skips Windows matrix when release is staged', () => {
  const workflow = readFileSync(
    path.join(process.cwd(), '.github/workflows/build-inference-editions.yml'),
    'utf8',
  );
  expect(workflow).toContain('windows-release-staged');
  expect(workflow).toContain('with-download-retries.sh');
});
