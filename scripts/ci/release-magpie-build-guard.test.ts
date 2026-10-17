import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const releaseWorkflow = readFileSync(
  path.join(process.cwd(), '.github/workflows/release.yml'),
  'utf8',
);

test('release workflow builds and verifies Magpie before packaging', () => {
  const buildStep = releaseWorkflow.indexOf('name: Build and verify pinned Magpie gateway');
  expect(buildStep).toBeGreaterThan(-1);
  expect(releaseWorkflow).toContain('bun run magpie:build --target');
  expect(releaseWorkflow).toContain('bun run magpie:verify --target');
  const windowsBuild = releaseWorkflow.indexOf('name: Build Windows release');
  const macBuild = releaseWorkflow.indexOf('name: Build unsigned macOS release');
  const linuxBuild = releaseWorkflow.indexOf('name: Build Linux release');
  expect(buildStep).toBeLessThan(windowsBuild);
  expect(buildStep).toBeLessThan(macBuild);
  expect(buildStep).toBeLessThan(linuxBuild);
  expect(releaseWorkflow).toContain('actions/setup-go@v6');
  expect(releaseWorkflow).toContain('resources/magpie/upstream.json');
});
