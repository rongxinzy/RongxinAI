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
  expect(releaseWorkflow).toContain(
    'needs: [prepare-release, preflight, build-windows, build-macos, build-linux]',
  );
  expect(releaseWorkflow).not.toContain('publish-windows:');
  expect(releaseWorkflow).not.toContain('publish-macos:');
  expect(releaseWorkflow).not.toContain('publish-linux:');
  expect(releaseWorkflow).toContain('fail-fast: false');
  expect(releaseWorkflow).toContain('build-windows-release.yml');
  expect(releaseWorkflow).toContain('collect-github-release-assets.mjs');
  expect(releaseWorkflow).toContain('verify-release-candidate.mjs');
  expect(RELEASE_PLATFORM_STAGES).toEqual(['win32', 'darwin', 'linux']);
});

test('build inference editions skips Windows matrix when release is staged', () => {
  const workflow = readFileSync(
    path.join(process.cwd(), '.github/workflows/build-inference-editions.yml'),
    'utf8',
  );
  expect(workflow).toContain('windows-release-staged');
  expect(workflow).toContain('with-download-retries.sh');
});
