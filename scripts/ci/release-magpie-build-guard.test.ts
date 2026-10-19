import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const read = (name: string) =>
  readFileSync(path.join(process.cwd(), '.github/workflows', name), 'utf8');

// release.yml delegates packaging to the reusable inference-edition workflow,
// so the Magpie build/verify ordering guard lives there.
const releaseWorkflow = read('release.yml');
const editionsWorkflow = read('build-inference-editions.yml');

test('release workflow packages through the reusable inference-edition workflow', () => {
  expect(releaseWorkflow).toContain('uses: ./.github/workflows/build-inference-editions.yml');
});

test('all packaging paths prepare pinned Magpie before packaging', () => {
  const shared = editionsWorkflow.indexOf('name: Prepare shared pinned Magpie gateway');
  const posix = editionsWorkflow.indexOf('name: Prepare pinned Magpie gateway for POSIX');
  expect(shared).toBeGreaterThan(-1);
  expect(posix).toBeGreaterThan(-1);
  expect(editionsWorkflow.indexOf('name: Build Windows (verify)')).toBeGreaterThan(shared);
  expect(editionsWorkflow.indexOf('name: Build macOS (verify)')).toBeGreaterThan(posix);
  expect(editionsWorkflow.indexOf('name: Build Linux (verify)')).toBeGreaterThan(posix);
  const action = readFileSync(
    path.join(process.cwd(), '.github/actions/prepare-magpie/action.yml'),
    'utf8',
  );
  expect(action).toContain('resources/magpie/upstream.json');
  expect(action).toContain('actions/setup-go@v6');
  expect(action).toContain('bun run magpie:build -- --target');
  expect(action).toContain('bun run magpie:verify -- --target');
  expect(action.indexOf('name: Verify runtime before packaging')).toBeGreaterThan(
    action.indexOf('name: Build pinned runtime on a cache miss'),
  );
});
