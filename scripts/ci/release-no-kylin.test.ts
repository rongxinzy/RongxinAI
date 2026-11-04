import { readFileSync } from 'node:fs';

import { load } from 'js-yaml';
import { expect, test } from 'vitest';

interface Step {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

interface Workflow {
  on: Record<string, unknown>;
  env: Record<string, unknown>;
  permissions: Record<string, unknown>;
  concurrency: Record<string, unknown>;
  jobs: Record<
    string,
    {
      needs?: string[];
      outputs?: Record<string, unknown>;
      steps?: Step[];
    }
  >;
}

const original = load(readFileSync('.github/workflows/release.yml', 'utf8')) as Workflow;
const manual = load(readFileSync('.github/workflows/release-no-kylin.yml', 'utf8')) as Workflow;
const platformJobs = ['build-windows', 'build-macos', 'build-linux'];

test('manual desktop release keeps all platform builds and release credentials unchanged', () => {
  expect(Object.keys(manual.jobs).sort()).toEqual(
    ['prepare-release', ...platformJobs, 'publish'].sort(),
  );
  for (const name of platformJobs) {
    expect(manual.jobs[name]).toEqual(original.jobs[name]);
  }
  expect(manual.env).toEqual(original.env);
  expect(manual.permissions).toEqual(original.permissions);
  expect(manual.concurrency).toEqual(original.concurrency);
  expect(manual.jobs['prepare-release'].outputs).toEqual(original.jobs['prepare-release'].outputs);
  expect(manual.jobs.publish.needs).toEqual(['prepare-release', ...platformJobs]);
});

test('manual release preserves publication checks and removes only the RPM artifact', () => {
  const expected = structuredClone(original.jobs.publish.steps ?? []);
  const withoutRpm = expected.filter(step => step.with?.name !== 'kylin-v11-x64-rpm');
  const release = withoutRpm.find(step => step.uses === 'softprops/action-gh-release@v2');
  expect(release?.with).toBeDefined();
  if (!release?.with) throw new Error('Missing GitHub release configuration');
  release.with.files = 'release-assets/*\n';
  release.with.target_commitish = '${{ needs.prepare-release.outputs.commit }}';
  expect(manual.jobs.publish.steps).toEqual(withoutRpm);
});

test('manual release creates tags through the release action without starting tag-triggered builds', () => {
  expect(Object.keys(manual.on)).toEqual(['workflow_dispatch']);
  const source = readFileSync('.github/workflows/release-no-kylin.yml', 'utf8');
  expect(source).toContain('git rev-parse "${GITHUB_SHA}^{commit}"');
  expect(source).toContain('git merge-base --is-ancestor "$source_commit" origin/main');
  expect(source).not.toContain('git push');
  expect(source).not.toContain('build-kylin-release.yml');
  expect(source).not.toContain('release-preflight.yml');
});
