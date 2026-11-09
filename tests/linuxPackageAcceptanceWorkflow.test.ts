import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { test } from 'vitest';

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  if?: string;
  run?: string;
  with?: Record<string, string | boolean>;
  env?: Record<string, string>;
}

const source = readFileSync('.github/workflows/linux-package-acceptance.yml', 'utf8');
const workflow = load(source) as {
  on: { push: { branches: string[] } };
  permissions: Record<string, string>;
  jobs: Record<
    string,
    {
      if: string;
      environment?: string;
      secrets?: unknown;
      strategy: { 'fail-fast': boolean; matrix: { edition: string[] } };
      env: Record<string, string>;
      steps: Step[];
    }
  >;
};
const job = workflow.jobs['verify-linux-packages'];
const step = (name: string) => {
  const found = job.steps.find(item => item.name === name);
  assert.ok(found, `Missing step: ${name}`);
  return found;
};

test('Linux package acceptance is restricted to the repair branch without release authority', () => {
  assert.deepEqual(workflow.on, {
    push: { branches: ['fix/linux-final-acceptance-20261109'] },
  });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.jobs), ['verify-linux-packages']);
  assert.equal(job.environment, undefined);
  assert.equal(job.secrets, undefined);
  assert.equal(
    job.if,
    "${{ github.repository == 'rongxinzy/RongxinAI' && " +
      "github.ref == 'refs/heads/fix/linux-final-acceptance-20261109' && " +
      "contains(github.event.head_commit.message, '[linux-package-acceptance]') }}",
  );
  assert.doesNotMatch(source, /secrets[.:]|mode: release|assemble-inference-candidate|publish:/);
  assert.deepEqual(job.strategy.matrix.edition, ['cpu', 'cuda']);
  assert.equal(job.strategy['fail-fast'], false);
});

test('Linux verification builds and accepts the same immutable checkout version', () => {
  const checkout = job.steps.find(item => item.uses === 'actions/checkout@v6');
  assert.deepEqual(checkout?.with, { ref: '${{ github.sha }}', 'persist-credentials': false });
  const identity = step('Bind verification to the checked-out source and version');
  assert.match(identity.run ?? '', /git rev-parse HEAD/);
  assert.match(identity.run ?? '', /\[\[ "\$commit" == "\$GITHUB_SHA" \]\]/);
  assert.match(identity.run ?? '', /require\('\.\/package.json'\).version/);
  assert.ok(
    identity.run?.includes(
      'version="${base_version}-acceptance.${GITHUB_RUN_ID}.${GITHUB_RUN_ATTEMPT}"',
    ),
  );
  const build = step('Build unsigned final Linux verification packages');
  assert.equal(build.uses, './.github/actions/build-inference-packages');
  assert.deepEqual(build.with, {
    mode: 'verify',
    platform: 'linux',
    'runtime-target': 'linux-x64',
    'inference-edition': '${{ matrix.edition }}',
    'app-build-version': '${{ steps.identity.outputs.version }}',
  });
  const acceptance = step('Install and render the final verification packages');
  assert.deepEqual(build.env, acceptance.env);
  assert.deepEqual(acceptance.env, {
    APP_BUILD_VERSION: '${{ steps.identity.outputs.version }}',
    ZHIYUAN_SOURCE_COMMIT: '${{ steps.identity.outputs.commit }}',
  });
  assert.equal(job.env.ZHIYUAN_UPDATE_VARIANT, '${{ matrix.edition }}');
  assert.equal(
    acceptance.run,
    'set -euo pipefail\n' +
      'node scripts/ci/linux-release-acceptance.mjs accept\n' +
      'node scripts/ci/linux-release-acceptance.mjs verify\n',
  );
});

test('Linux verification requires FUSE and uploads only accepted packages', () => {
  const fuse = step('Require real AppImage FUSE support before building');
  const build = step('Build unsigned final Linux verification packages');
  const accept = step('Install and render the final verification packages');
  const upload = step('Upload accepted verification packages');
  assert.equal(fuse.run, 'test -r /dev/fuse && test -w /dev/fuse');
  assert.ok(job.steps.indexOf(fuse) < job.steps.indexOf(build));
  assert.ok(job.steps.indexOf(build) < job.steps.indexOf(accept));
  assert.ok(job.steps.indexOf(accept) < job.steps.indexOf(upload));
  assert.equal(upload.if, undefined);
  assert.equal(upload.with?.path, 'release/*.deb\nrelease/*.AppImage\n');
  const evidence = step('Upload verification evidence');
  assert.equal(evidence.if, '${{ always() }}');
  for (const item of [upload, evidence]) {
    assert.match(String(item.with?.name), /matrix.edition.*github.run_id.*github.run_attempt/);
    assert.equal(item.with?.['if-no-files-found'], 'error');
  }
  assert.doesNotMatch(source, /APPIMAGE_EXTRACT|linux-unpacked|continue-on-error/);
});
