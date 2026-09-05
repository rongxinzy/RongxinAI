import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';
import { BaselineJob, CiEvent, HeavyJob, JobResult } from './constants.ts';
import { planGates, verifyGateResults, type GatePlan } from './policy.ts';

const prRef = 'refs/pull/42/merge';
const light = planGates(['src/renderer/components/Settings.tsx'], CiEvent.PullRequest, prRef);
const full = planGates(['package.json'], CiEvent.PullRequest, prRef);

test.each([
  'README.md',
  'docs/development.md',
  'src/renderer/components/Settings.tsx',
  'src/renderer/theme/themes.css',
  'unknown/new-module.ts',
])('ordinary and unknown paths retain only baseline checks: %s', file => {
  expect(Object.values(planGates([file], CiEvent.PullRequest, prRef))).toEqual([
    false,
    false,
    false,
  ]);
});

test.each([
  'bun.lock',
  'package.json',
  'electron-builder.json',
  'electron-builder.windows-signed.cjs',
  'electron-tsconfig.json',
  'vite.config.ts',
  'patches/runtime.patch',
  'resources/python-linux/bin/python',
  'build/installer.nsh',
  'scripts/setup-python-runtime.js',
  'SKILLs/pdf/requirements.txt',
  'MCPs/feishu/server.js',
  '.github/workflows/ci.yml',
  'src/main/main.ts',
  'src/main/newPlatformModule.ts',
])('packaging and main-process changes run all heavy checks: %s', file => {
  expect(Object.values(planGates([file], CiEvent.PullRequest, prRef))).toEqual([true, true, true]);
});

test.each([
  'src/renderer/services/cowork.ts',
  'src/renderer/services/streamRequestRegistry.ts',
  'src/renderer/hooks/useIpcChat.ts',
  'src/renderer/store/slices/coworkSlice.ts',
  'src/renderer/components/cowork/hooks/useTodoQueueLifecycle.ts',
  'src/shared/components/ai-elements/conversation.tsx',
  'src/renderer/App.tsx',
])('renderer lifecycle changes run memory without packaging: %s', file => {
  expect(planGates([file], CiEvent.PullRequest, prRef)).toEqual({
    ...light,
    [HeavyJob.Memory]: true,
  });
});

test('manual runs and unknown events fail closed to the complete suite', () => {
  expect(planGates([], CiEvent.Manual, 'refs/heads/main')).toEqual(full);
  expect(planGates([], 'unexpected-event', 'refs/heads/main')).toEqual(full);
});

test('main pushes are light while tag releases retain mandatory memory regression', () => {
  expect(planGates(['package.json'], CiEvent.Push, 'refs/heads/main')).toEqual(light);
  expect(planGates([], CiEvent.Push, 'refs/tags/v2026.9.5')).toEqual({
    ...light,
    [HeavyJob.Memory]: true,
  });
});

function resultsFor(plan: GatePlan) {
  const results: Record<string, { result: string }> = Object.fromEntries(
    Object.values(BaselineJob).map(name => [name, { result: JobResult.Success }]),
  );
  for (const [name, enabled] of Object.entries(plan)) {
    results[name] = { result: enabled ? JobResult.Success : JobResult.Skipped };
  }
  return results;
}

test('merge gate permits only intentional skips', () => {
  expect(() => verifyGateResults(light, resultsFor(light))).not.toThrow();
  expect(() => verifyGateResults(full, resultsFor(full))).not.toThrow();
});

test.each([JobResult.Failure, JobResult.Cancelled, JobResult.Skipped])(
  'required check %s cannot pass the gate',
  result => {
    for (const name of Object.keys(resultsFor(full))) {
      const results = resultsFor(full);
      results[name] = { result };
      expect(() => verifyGateResults(full, results)).toThrow();
    }
  },
);

test('missing jobs and incomplete decisions cannot pass the gate', () => {
  const results = resultsFor(full);
  delete results[HeavyJob.Linux];
  expect(() => verifyGateResults(full, results)).toThrow();
  expect(() => verifyGateResults({} as GatePlan, resultsFor(light))).toThrow();
});

test('unexpected failure of an optional check cannot be hidden', () => {
  const results = resultsFor(light);
  results[HeavyJob.Memory] = { result: JobResult.Failure };
  expect(() => verifyGateResults(light, results)).toThrow();
});

interface WorkflowJob {
  needs?: string | string[];
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  steps?: Array<{ name?: string; run?: string; uses?: string; with?: Record<string, unknown> }>;
}

function workflow(name: string) {
  return load(
    readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8'),
  ) as {
    on: Record<string, unknown>;
    jobs: Record<string, WorkflowJob>;
  };
}

test('CI waits for every selected reusable check and always runs the merge gate', () => {
  const ci = workflow('ci.yml');
  expect(ci.on).toHaveProperty(CiEvent.PullRequest);
  const gate = ci.jobs['merge-gate'];
  expect(gate.if).toBe('always()');
  expect(gate.needs).toEqual(
    expect.arrayContaining([...Object.values(BaselineJob), ...Object.values(HeavyJob)]),
  );
  for (const job of Object.values(HeavyJob)) {
    expect(ci.jobs[job].needs).toBe(BaselineJob.Changes);
    expect(ci.jobs[job].if).toBe(`needs.changes.outputs.${job} == 'true'`);
    expect(ci.jobs[job].uses).toMatch(/\.yml$/);
  }
  for (const file of ['linux-install-pr.yml', 'windows-installer-pr.yml']) {
    expect(workflow(file).on).toHaveProperty('workflow_call');
    expect(workflow(file).on).not.toHaveProperty(CiEvent.PullRequest);
  }
});

test('candidate checks bind the source commit and block packaging before memory succeeds', () => {
  const candidate = workflow('release-candidate.yml');
  const memoryJob = candidate.jobs['memory-regression'];
  expect(memoryJob.uses).toBe(workflow('ci.yml').jobs[HeavyJob.Memory].uses);
  expect(memoryJob.with?.['source-ref']).toBe('${{ needs.prepare-candidate.outputs.commit }}');
  expect(candidate.jobs['build-candidate'].needs).toContain('memory-regression');
  const qualityCommands = candidate.jobs.quality.steps?.map(step => step.run ?? '').join('\n');
  expect(qualityCommands).toContain('bun run build:tsc');
  expect(qualityCommands).toContain('bun run test:bundle-budget');
  const steps = candidate.jobs['build-candidate'].steps ?? [];
  const install = steps.findIndex(step =>
    step.run?.includes('sudo apt-get install -y "$(realpath'),
  );
  const payload = steps.findIndex(step => step.name === 'Assemble Linux candidate payload');
  expect(install).toBeGreaterThan(-1);
  expect(payload).toBeGreaterThan(install);
  expect(steps[install].run).toContain("'/opt/知远/知远'");
  expect(workflow('memory-leak-nightly.yml').jobs[HeavyJob.Memory].uses).toBe(memoryJob.uses);
  expect(workflow('memory-leak-nightly.yml').jobs[HeavyJob.Memory].with?.['analyze-heap']).toBe(
    true,
  );
});
