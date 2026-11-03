import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const read = (name: string) =>
  readFileSync(path.join(process.cwd(), '.github/workflows', name), 'utf8');

// release.yml delegates packaging to the reusable inference-edition workflow,
// so the Magpie build/verify ordering guard lives there.
const releaseWorkflow = read('release.yml');
const editionsWorkflow = read('build-inference-editions.yml');
const kylinWorkflow = read('build-kylin-release.yml');

test('release workflow packages through the reusable inference-edition workflow', () => {
  expect(releaseWorkflow).toContain('uses: ./.github/workflows/build-inference-editions.yml');
  expect(releaseWorkflow).toContain('uses: ./.github/workflows/build-kylin-release.yml');
});

test('inference-edition workflow builds and verifies Magpie before packaging', () => {
  const buildStep = editionsWorkflow.indexOf('name: Build and verify pinned Magpie gateway');
  expect(buildStep).toBeGreaterThan(-1);
  expect(editionsWorkflow).toContain('bun run magpie:build -- --target');
  expect(editionsWorkflow).toContain('bun run magpie:verify -- --target');
  for (const packagingStep of [
    'name: Build Windows (verify)',
    'name: Build Windows release (lite)',
    'name: Build macOS (verify)',
    'name: Build unsigned macOS release',
    'name: Build Linux (verify)',
    'name: Build Linux release',
  ]) {
    const index = editionsWorkflow.indexOf(packagingStep);
    expect(index, packagingStep).toBeGreaterThan(buildStep);
  }
  expect(editionsWorkflow).toContain('actions/setup-go@v6');
  expect(editionsWorkflow).toContain('resources/magpie/upstream.json');
});

test('Kylin workflow builds and verifies Magpie before packaging', () => {
  const buildStep = kylinWorkflow.indexOf('name: Build and verify pinned Magpie gateway');
  const packageStep = kylinWorkflow.indexOf('name: Build Kylin V11 RPM package');
  expect(buildStep).toBeGreaterThan(-1);
  expect(packageStep).toBeGreaterThan(buildStep);
  expect(kylinWorkflow).toContain('bun run magpie:build -- --target linux-x64');
  expect(kylinWorkflow).toContain('bun run magpie:verify -- --target linux-x64');
});
