import { readInferenceWorkflow } from './read-inference-workflow.mjs';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';

const read = (name: string) =>
  name === 'build-inference-editions.yml'
    ? readInferenceWorkflow()
    : readFileSync(path.join(process.cwd(), '.github/workflows', name), 'utf8');

// release.yml delegates packaging to the reusable inference-edition workflow,
// so the Magpie build/verify ordering guard lives there.
const releaseWorkflow = read('release.yml');
const editionsWorkflow = read('build-inference-editions.yml');
const kylinPackageWorkflow = read('package-kylin-v11.yml');
const kylinWorkflow = read('build-kylin-release.yml');
const prepare = 'uses: ./.github/actions/prepare-magpie-runtime';
const prepareWindows = 'uses: ./.github/actions/prepare-windows-packaging-runtime';
const prepareSource = readFileSync('.github/actions/prepare-magpie-runtime/action.yml', 'utf8');

test('release workflow packages through the reusable inference-edition workflow', () => {
  expect(releaseWorkflow).toContain('uses: ./.github/workflows/build-inference-editions.yml');
  expect(releaseWorkflow).not.toContain('uses: ./.github/workflows/build-kylin-release.yml');
});

test('Kylin workflow is exposed through a standalone manual package entry', () => {
  expect(kylinPackageWorkflow).toContain('workflow_dispatch:');
  expect(kylinPackageWorkflow).toContain('uses: ./.github/workflows/build-kylin-release.yml');
});

test('inference-edition workflow builds and verifies Magpie before packaging', () => {
  const buildStep = editionsWorkflow.indexOf(prepare);
  expect(buildStep).toBeGreaterThan(-1);
  expect(editionsWorkflow).toContain(
    "target: ${{ matrix.platform == 'linux' && 'linux-x64' || matrix.platform == 'windows' && 'win32-x64' || (matrix.arch == 'arm64' && 'darwin-arm64' || 'darwin-x64') }}",
  );
  for (const packagingStep of [
    'name: Build Windows (verify)',
    'name: Build Windows release (lite)',
    'name: Build macOS packages',
    'name: Build Linux packages',
  ]) {
    const index = editionsWorkflow.indexOf(packagingStep);
    expect(index, packagingStep).toBeGreaterThan(buildStep);
  }
});

test('Kylin workflow builds and verifies Magpie before packaging', () => {
  const buildStep = kylinWorkflow.indexOf(prepare);
  const packageStep = kylinWorkflow.indexOf('name: Build Kylin V11 RPM package');
  expect(buildStep).toBeGreaterThan(-1);
  expect(packageStep).toBeGreaterThan(buildStep);
  expect(kylinWorkflow).toMatch(
    /prepare-magpie-runtime\s+with:\s+target: linux-x64\s+build-attempts: '3'/,
  );
});

test('Windows inference builds in both modes use the shared native process checks', () => {
  const runtime = editionsWorkflow.indexOf(prepareWindows);
  expect(runtime).toBeGreaterThan(editionsWorkflow.indexOf(prepare));
  expect(editionsWorkflow).toContain(
    "- if: ${{ matrix.platform == 'windows' }}\n        " + prepareWindows,
  );
  for (const packaging of [
    'Build Windows (verify)',
    'Build Windows release (lite)',
    'Build Windows release (cuda)',
  ]) {
    expect(editionsWorkflow.indexOf(`name: ${packaging}`), packaging).toBeGreaterThan(runtime);
  }
});

test.each([
  ['windows-installer-pr.yml', 'Build complete offline installer'],
  ['build-windows-release.yml', 'Build signed Windows core (lite)'],
])('%s prepares and verifies the same Windows runtime before packaging', (name, packageStep) => {
  const workflow = read(name);
  const build = workflow.indexOf(prepare);
  const runtime = workflow.indexOf(prepareWindows);
  expect(build).toBeGreaterThan(-1);
  expect(workflow).toMatch(/prepare-magpie-runtime\s+with:\s+target: win32-x64/);
  expect(runtime).toBeGreaterThan(build);
  expect(workflow.indexOf(`name: ${packageStep}`)).toBeGreaterThan(runtime);
});

test('the shared Windows runtime action builds the native helper and verifies both shutdown paths', () => {
  const action = load(
    readFileSync('.github/actions/prepare-windows-packaging-runtime/action.yml', 'utf8'),
  ) as { runs: { steps: Array<{ uses?: string; run?: string; env?: Record<string, string> }> } };
  const [offline, msvc, jobHelper, magpie] = action.runs.steps;
  expect(offline.run).toContain('bun run setup:uv-runtime');
  expect(offline.run).toContain('bun run setup:python-runtime');
  expect(msvc.uses).toBe('ilammy/msvc-dev-cmd@v1');
  expect(jobHelper.run).toContain('./scripts/python-runtime/build-job-runner.ps1');
  expect(jobHelper.run).toContain('node --test scripts/python-runtime/job-runner.test.cjs');
  expect(magpie.env?.ZHIYUAN_MAGPIE_SMOKE).toBe('1');
  expect(magpie.run).toContain('src/main/magpie/integration.test.ts');
  expect(magpie.run).toContain('-t "discovers and updates a fixture CLI"');
});

test.each([
  { failures: 0, status: 0, calls: ['build', 'verify'] },
  { failures: 2, status: 0, calls: ['build', 'build', 'build', 'verify'] },
  { failures: 3, status: 1, calls: ['build', 'build', 'build'] },
])('shared Magpie build with $failures transient failures', ({ failures, status, calls }) => {
  const action = load(prepareSource) as { runs: { steps: Array<{ name?: string; run?: string }> } };
  const step = action.runs.steps.find(
    item => item.name === 'Build and verify pinned Magpie gateway',
  );
  expect(step?.run).toBeTruthy();
  expect(prepareSource).toContain("require('./resources/magpie/upstream.json')");
  expect(prepareSource).toContain('go-version: ${{ steps.toolchain.outputs.go-version }}');
  const fixture = `
go() { echo 'go version go1.26.8 linux/amd64'; }
sleep() { :; }
bun() {
  test "$5" = linux-x64 || return 2
  echo "$2"
  if [ "$2" = magpie:build ] && [ "$FAILURES" -gt 0 ]; then
    FAILURES=$((FAILURES - 1))
    return 1
  fi
}
`;
  const result = spawnSync('bash', ['-eo', 'pipefail', '-c', fixture + step?.run], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MAGPIE_TARGET: 'linux-x64',
      MAGPIE_GO_VERSION: '1.26.8',
      MAGPIE_BUILD_ATTEMPTS: '3',
      FAILURES: String(failures),
    },
  });
  expect(result.status, result.stderr).toBe(status);
  expect(result.stdout.trim().split('\n')).toEqual(calls.map(call => `magpie:${call}`));
});
