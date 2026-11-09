import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';

type Job = {
  if?: string;
  needs?: string;
  uses?: string;
  environment?: string;
  with?: Record<string, unknown>;
  secrets?: Record<string, string> | string;
  steps?: { run?: string; env?: Record<string, string> }[];
};
type Workflow = {
  on: {
    workflow_dispatch?: { inputs: Record<string, { default?: unknown }> };
    workflow_call?: {
      inputs: Record<string, { default?: unknown }>;
      secrets: Record<string, { required: boolean }>;
    };
  };
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};
const readWorkflow = (name: string) =>
  load(readFileSync('.github/workflows/' + name, 'utf8')) as Workflow;

test('signed Windows acceptance is opt-in, source-validated and has no publication job', () => {
  const workflow = readWorkflow('build-platforms.yml');
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  expect(workflow.on.workflow_dispatch?.inputs.signed_windows_acceptance.default).toBe(false);
  expect(workflow.permissions).toEqual({ contents: 'read' });
  expect(Object.keys(workflow.jobs)).toEqual([
    'verify-inference-editions',
    'signed-windows-identity',
    'signed-windows-acceptance',
  ]);
  expect(workflow.jobs['signed-windows-identity'].if).toBe(
    '${{ inputs.signed_windows_acceptance }}',
  );
  const build = workflow.jobs['signed-windows-acceptance'];
  expect(build.needs).toBe('signed-windows-identity');
  expect(build.uses).toBe('./.github/workflows/build-windows-release.yml');
  expect(build.with).toEqual({
    'source-ref': '${{ needs.signed-windows-identity.outputs.commit }}',
    'app-build-version': '${{ needs.signed-windows-identity.outputs.version }}',
    'enterprise-extension': false,
    'include-modelscope-token': false,
  });
  expect(Object.keys(build.secrets || {})).toEqual([
    'CERTUM_USER_ID',
    'CERTUM_OTP_URI',
    'CERTUM_CERT_THUMBPRINT',
    'UPDATE_MANIFEST_KEY_ID',
    'UPDATE_MANIFEST_PUBLIC_KEY_BASE64',
  ]);
  for (const [key, value] of Object.entries(build.secrets || {})) {
    expect(value).toBe('${{ secrets.' + key + ' }}');
  }
});

test('unsigned defaults and protected release signing environment remain intact', () => {
  const workflow = readWorkflow('build-platforms.yml');
  const unsigned = workflow.jobs['verify-inference-editions'];
  expect(unsigned.if).toBe('${{ !inputs.signed_windows_acceptance }}');
  expect(unsigned.uses).toBe('./.github/workflows/build-inference-editions.yml');
  expect(unsigned.with).toEqual({
    'source-ref': '${{ github.sha }}',
    mode: 'verify',
    'fail-fast': false,
    'build-macos': '${{ inputs.build_macos }}',
    'build-windows': '${{ inputs.build_windows }}',
    'build-linux': '${{ inputs.build_linux }}',
    'linux-inference-editions': 'cpu,cuda',
  });
  expect(unsigned.secrets).toEqual({ MODELSCOPE_TOKENS: '${{ secrets.MODELSCOPE_TOKENS }}' });
  for (const name of ['build_macos', 'build_windows', 'build_linux']) {
    expect(workflow.on.workflow_dispatch?.inputs[name].default).toBe(true);
  }
  const callee = readWorkflow('build-windows-release.yml');
  expect(callee.permissions).toEqual({ contents: 'read' });
  expect(callee.jobs['windows-release'].environment).toBe('release');
  expect(callee.on.workflow_call?.secrets.MODELSCOPE_TOKENS.required).toBe(false);
  expect(callee.on.workflow_call?.inputs['include-modelscope-token'].default).toBe(true);
  const injections = callee.jobs['windows-release'].steps?.filter(
    step => step.env && 'MODELSCOPE_TOKENS' in step.env,
  );
  expect(injections).toHaveLength(3);
  for (const step of injections || []) {
    expect(step.env?.MODELSCOPE_TOKENS).toBe(
      "${{ inputs.include-modelscope-token && secrets.MODELSCOPE_TOKENS || '' }}",
    );
  }
  const releaseSecrets = readWorkflow('release.yml').jobs['build-windows'].secrets;
  expect(typeof releaseSecrets).toBe('object');
  expect((releaseSecrets as Record<string, string>).MODELSCOPE_TOKENS).toBe(
    '${{ secrets.MODELSCOPE_TOKENS }}',
  );
  expect(readWorkflow('enterprise-windows.yml').jobs.package.secrets).toBe('inherit');
});

const valid = {
  SOURCE_SHA: 'a'.repeat(40),
  DISPATCH_SHA: 'a'.repeat(40),
  DISPATCH_REF: 'refs/heads/fix/windows-release-acceptance-20261109',
  TEST_VERSION: '2026.11.9-acceptance.1',
};
for (const [name, overrides, accepted] of [
  ['reviewed head', {}, true],
  [
    'reviewed integration',
    { DISPATCH_REF: 'refs/heads/release/validation-ci-takeover-20261109' },
    true,
  ],
  ['short SHA', { SOURCE_SHA: 'aaaaaaa' }, false],
  ['different head', { SOURCE_SHA: 'b'.repeat(40) }, false],
  ['different branch', { DISPATCH_REF: 'refs/heads/main' }, false],
  ['tag dispatch', { DISPATCH_REF: 'refs/tags/v2026.11.9' }, false],
  ['stable version', { TEST_VERSION: '2026.11.9' }, false],
  ['wrong prerelease', { TEST_VERSION: '2026.11.9-beta.1' }, false],
  ['zero attempt', { TEST_VERSION: '2026.11.9-acceptance.0' }, false],
  ['shell injection', { TEST_VERSION: '2026.11.9-acceptance.1; exit 0' }, false],
] as const) {
  test('signed acceptance identity guard: ' + name, () => {
    const run = readWorkflow('build-platforms.yml').jobs['signed-windows-identity'].steps?.[0].run;
    expect(typeof run).toBe('string');
    const root = mkdtempSync(path.join(os.tmpdir(), 'windows-build-only-'));
    const output = path.join(root, 'output');
    try {
      const result = spawnSync('bash', ['-c', run!], {
        encoding: 'utf8',
        env: { ...process.env, ...valid, ...overrides, GITHUB_OUTPUT: output },
      });
      expect(result.status === 0).toBe(accepted);
      if (accepted) {
        expect(readFileSync(output, 'utf8')).toBe(
          'commit=' + valid.SOURCE_SHA + '\nversion=' + valid.TEST_VERSION + '\n',
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
