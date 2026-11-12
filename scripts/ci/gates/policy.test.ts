import { readInferenceWorkflow } from '../read-inference-workflow.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';
import { BaselineJob, JobResult, PackagingJob, PreflightJob, TestShardCount } from './constants.ts';
import { verifyGateResults, verifyPreflightResults } from './policy.ts';

type Step = { name?: string; run?: string; uses?: string; with?: Record<string, unknown> };
type Job = {
  name?: string;
  if?: string;
  needs?: string | string[];
  uses?: string;
  with?: Record<string, unknown>;
  steps?: Step[];
  strategy?: { matrix?: { shard?: number[] } };
};
type Workflow = { on: Record<string, unknown>; jobs: Record<string, Job> };
const workflow = (name: string) =>
  load(readFileSync(`.github/workflows/${name}`, 'utf8')) as Workflow;
const resultsFor = (names: string[]) =>
  Object.fromEntries(names.map(name => [name, { result: JobResult.Success as string }]));

test('workflow dependency installs do not hardlink packages into the Bun cache', () => {
  const files = [
    ...readdirSync('.github/workflows')
      .filter(name => name.endsWith('.yml'))
      .map(name => `.github/workflows/${name}`),
    ...readdirSync('.github/actions').map(name => `.github/actions/${name}/action.yml`),
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const line of source.split('\n').filter(line => /\brun: bun install\b/.test(line))) {
      expect(line, file).toContain('--backend copyfile');
    }
  }
});

test('daily feature CI runs lint, typecheck, and parallel unit tests before its gate', () => {
  const ci = workflow('ci.yml');
  expect(Object.keys(ci.jobs).sort()).toEqual(['ci-gate', 'lint', 'test', 'typecheck']);
  const typecheckRuns = ci.jobs.typecheck.steps?.map(step => step.run ?? '').join('\n') ?? '';
  expect(typecheckRuns).toContain('bun run build:tsc');
  expect(
    ci.jobs.typecheck.steps?.some(step => step.uses === './.github/actions/setup-bun-workspace'),
  ).toBe(true);
  expect(
    typecheckRuns.match(/compile:electron|rebuild:electron-native|build:vite|dist:/) ?? [],
  ).toHaveLength(0);
  expect(ci.jobs.test.needs).toBeUndefined();
  expect(ci.jobs.test.strategy?.matrix?.shard).toEqual(
    Array.from({ length: TestShardCount }, (_, i) => i + 1),
  );
  const steps = ci.jobs.test.steps ?? [];
  const commands = steps.map(step => step.run ?? '').join('\n');
  expect(commands).toContain('bun run test:unit');
  expect(commands).toContain('bun run test:enterprise');
  expect(commands).not.toMatch(
    /compile:electron|rebuild:electron-native|build:vite|dist:|streaming-mutations/,
  );
  expect(steps.some(step => step.uses?.startsWith('actions/download-artifact'))).toBe(false);
  expect(ci.jobs['ci-gate'].if).toBe('always()');
  expect(ci.jobs['ci-gate'].needs).toEqual(Object.values(BaselineJob));
});

test.each([JobResult.Failure, JobResult.Cancelled, JobResult.Skipped, 'missing'])(
  'daily gate rejects a %s unit or lint result',
  result => {
    for (const name of Object.values(BaselineJob)) {
      const results = resultsFor(Object.values(BaselineJob));
      if (result === 'missing') delete results[name];
      else results[name].result = result;
      expect(() => verifyGateResults(results)).toThrow();
    }
  },
);

test('release preflight gates every retained heavy check and binds one source commit', () => {
  const preflight = workflow('release-preflight.yml');
  expect(preflight.on).toHaveProperty('workflow_dispatch');
  expect(preflight.on).toHaveProperty('workflow_call');
  expect(preflight.on).not.toHaveProperty('pull_request');
  const gate = preflight.jobs['preflight-gate'];
  expect(gate.if).toBe('always()');
  expect(gate.needs).toEqual(
    expect.arrayContaining([...Object.values(PreflightJob), ...Object.values(PackagingJob)]),
  );
  for (const name of Object.values(PreflightJob).filter(name => name !== PreflightJob.Source)) {
    const job = preflight.jobs[name];
    expect(job.needs).toBe('source');
    const checkout = job.steps?.find(step => step.uses === 'actions/checkout@v6');
    expect(checkout?.with?.ref ?? job.with?.['source-ref']).toBe(
      '${{ needs.source.outputs.commit }}',
    );
  }
  const quality = preflight.jobs.quality.steps?.map(step => step.run ?? '').join('\n');
  expect(quality).toContain('bun run test:full');
  expect(quality).toContain('bun run test:streaming-mutations');
  expect(quality).toContain('bun run test:bundle-budget');
});

test('release preflight does not forward secrets to unsigned Linux packaging', () => {
  const preflight = workflow('release-preflight.yml');
  const linux = preflight.jobs['linux-install'];
  expect(linux).not.toHaveProperty('secrets');
  expect(linux.uses).toBe('./.github/workflows/linux-install-pr.yml');
  expect(linux.if).toBe('inputs.include-packaging');
  expect(linux.with?.['source-ref']).toBe('${{ needs.source.outputs.commit }}');
  const callable = preflight.on.workflow_call as {
    secrets?: { MODELSCOPE_TOKENS?: { required?: boolean } };
  };
  expect(callable.secrets?.MODELSCOPE_TOKENS?.required).toBe(false);
});

test('preflight refuses every missing, skipped, failed, or cancelled mandatory check', () => {
  const required = Object.values(PreflightJob);
  for (const name of required) {
    for (const result of Object.values(JobResult).filter(value => value !== JobResult.Success)) {
      const results = resultsFor([...required, ...Object.values(PackagingJob)]);
      results[name].result = result;
      expect(() => verifyPreflightResults(results, true)).toThrow();
      delete results[name];
      expect(() => verifyPreflightResults(results, true)).toThrow();
    }
  }
});

test('only tag builds may replace unsigned install runs with their signed package acceptance', () => {
  const results = resultsFor(Object.values(PreflightJob));
  for (const name of Object.values(PackagingJob)) results[name] = { result: JobResult.Skipped };
  expect(() => verifyPreflightResults(results, false)).not.toThrow();
  expect(() => verifyPreflightResults(results, true)).toThrow();
  for (const name of Object.values(PackagingJob)) results[name].result = JobResult.Success;
  expect(() => verifyPreflightResults(results, true)).not.toThrow();
});

test('release builds platforms in parallel and publication waits for all platforms', () => {
  const release = workflow('release.yml');
  expect(release.jobs.preflight).toBeUndefined();
  const releaseJobs = ['release-typecheck', 'verify-release-candidate'];
  for (const job of releaseJobs) {
    expect(release.jobs[job].needs).toBe('prepare-release');
  }
  const typecheckRuns =
    release.jobs['release-typecheck'].steps?.map(step => step.run ?? '').join('\n') ?? '';
  expect(typecheckRuns).toContain('bun run build:tsc');
  const candidateVerify =
    release.jobs['verify-release-candidate'].steps?.map(step => step.run ?? '').join('\n') ?? '';
  expect(candidateVerify).toContain('verify-release-candidate-readiness.mjs');
  for (const platform of ['windows', 'macos', 'linux']) {
    expect(release.jobs[`build-${platform}`].needs).toEqual(
      expect.arrayContaining(['prepare-release', ...releaseJobs]),
    );
    expect(release.jobs.publish.needs).toEqual(
      expect.arrayContaining(['prepare-release', `build-${platform}`]),
    );
  }
  expect(release.jobs.publish.if).toBeUndefined();
});

test('release preflight publishes source record and packaging attestation artifacts', () => {
  const source = workflow('release-preflight.yml').jobs.source;
  const sourceJoined = JSON.stringify(source.steps ?? []);
  expect(sourceJoined).toContain('publish-preflight-source-record.mjs');
  expect(sourceJoined).toContain('release-preflight-source');
  expect(source.permissions).toMatchObject({ actions: 'write' });
  const gate = workflow('release-preflight.yml').jobs['preflight-gate'];
  const gateSteps = gate.steps?.map(step => step.run ?? step.uses ?? '').join('\n') ?? '';
  expect(gateSteps).toContain('publish-release-candidate-attestation.mjs');
  expect(gateSteps).toContain('release-candidate-attestation');
});

test('release verifier checks out the trusted tagged source commit', () => {
  const verify = workflow('release.yml').jobs['verify-release-candidate'];
  const checkout = verify.steps?.find(step => step.uses === 'actions/checkout@v6');
  expect(checkout?.with?.ref).toBe('${{ needs.prepare-release.outputs.commit }}');
});

test('no secondary workflow can start heavy builds for a feature pull request', () => {
  for (const file of readdirSync('.github/workflows').filter(
    file => file.endsWith('.yml') && file !== 'ci.yml',
  )) {
    const triggers = workflow(file).on;
    expect(triggers, file).not.toHaveProperty('pull_request');
    expect(triggers, file).not.toHaveProperty('pull_request_target');
  }
  for (const file of [
    'build-platforms.yml',
    'windows-installer-pr.yml',
    'memory-leak-nightly.yml',
  ]) {
    expect(workflow(file).on, file).not.toHaveProperty('schedule');
  }
});

test('Windows CUDA preflight and release share exact caches and always verify restored output', () => {
  for (const file of ['build-windows-release.yml', 'build-inference-editions.yml']) {
    expect(
      file === 'build-inference-editions.yml'
        ? readInferenceWorkflow()
        : readFileSync(`.github/workflows/${file}`, 'utf8'),
    ).toContain('uses: ./.github/actions/prepare-windows-cuda');
  }
  const action = load(readFileSync('.github/actions/prepare-windows-cuda/action.yml', 'utf8')) as {
    runs: { steps: Array<Step & { if?: string }> };
  };
  const steps = action.runs.steps;
  const restore = steps.find(step => step.uses === 'actions/cache/restore@v5');
  expect(restore?.with).not.toHaveProperty('restore-keys');
  expect(restore?.with?.key).not.toContain("hashFiles('package.json'");
  const verify = steps.findIndex(step => step.run?.includes('runtime-tree-integrity.cjs verify'));
  expect(steps[verify].if).toBeUndefined();
  expect(steps[verify].run).toContain('verifyWindowsDllClosure');
  const save = steps.findIndex(step => step.uses === 'actions/cache/save@v5');
  expect(save).toBeGreaterThan(verify);
  const build = steps.find(step => step.run?.includes('build-llamacpp-cuda-rtx40.sh win'));
  expect(build?.if).toBe("steps.runtime.outputs.cache-hit != 'true'");
});
