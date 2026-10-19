import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

import { listReleaseCandidateBundles } from '../release/release-candidate-layout.mjs';

const promoteWorkflow = readFileSync(
  path.join(process.cwd(), '.github/workflows/promote.yml'),
  'utf8',
);

test('promote loads all generation build metadata dynamically', () => {
  expect(promoteWorkflow).not.toMatch(/for index in 1 2 3 4/);
  expect(promoteWorkflow).not.toMatch(/update-artifacts-1\.json/);
  expect(promoteWorkflow).toContain('fetch-generation-build-metadata.sh');
  expect(promoteWorkflow).toMatch(/metadata=\(uploaded-metadata\/update-artifacts-\*\.json\)/);
  expect(promoteWorkflow).toContain('print-electron-updater-verify-specs.mjs');
});

test('fetch-generation-build-metadata expects one metadata file per release bundle', () => {
  const script = readFileSync(
    path.join(process.cwd(), 'scripts/release/fetch-generation-build-metadata.sh'),
    'utf8',
  );
  expect(script).toContain('list-objects-v2');
  expect(script).toContain('listReleaseCandidateBundles');
  expect(listReleaseCandidateBundles().length).toBeGreaterThan(4);
});
