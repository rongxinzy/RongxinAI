import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';
import { BaselineJob, CiEvent, HeavyJob, JobResult, PathJob, TestShardCount } from './constants.ts';
import {
  enterpriseRequired,
  planGates,
  planPathJobs,
  verifyGateResults,
  type GatePlan,
  type PathPlan,
} from './policy.ts';

const noPathJobs: PathPlan = {
  [PathJob.ChannelRuntime]: false,
  [PathJob.PythonRuntimeLinux]: false,
  [PathJob.PythonRuntimeWindows]: false,
  [PathJob.InstallerPreview]: false,
};

const prRef = 'refs/pull/42/merge';
const light = planGates(['src/renderer/components/Settings.tsx'], CiEvent.PullRequest, prRef);
const full: GatePlan = {
  [HeavyJob.Linux]: true,
  [HeavyJob.Windows]: true,
  [HeavyJob.Memory]: true,
};
const prPackaging: GatePlan = {
  [HeavyJob.Linux]: false,
  [HeavyJob.Windows]: false,
  [HeavyJob.Memory]: true,
};

test.each([
  'README.md',
  'docs/development.md',
  'docs/2026-10-15-installer-website-style.md',
  'website/index.html',
  'website/README.md',
  'src/renderer/components/Settings.tsx',
  'src/renderer/theme/themes.css',
  'src/renderer/components/artifacts/renderers/DxfRenderer.tsx',
  'src/renderer/components/cowork/components/UserBubble.tsx',
  'src/renderer/components/cowork/CoworkPromptInput.tsx',
  'scripts/ensure-build-version.js',
  'scripts/find-dev-port.mjs',
  '.github/workflows/stale.yml',
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
  'scripts/nsis-installer.nsh',
  'scripts/nsis-offline-components.json',
  'scripts/installer-ui/zy-pages.nsh',
  'scripts/ci/windows-installer-interactive.ps1',
  'scripts/ci/windows-shell-interactive.mjs',
  'scripts/ci/gates/policy.ts',
  'tests/nsis-installer.test.ts',
  'SKILLs/pdf/requirements.txt',
  'MCPs/feishu/server.js',
  '.github/workflows/ci.yml',
  'src/main/main.ts',
  'src/main/newPlatformModule.ts',
])(
  'packaging and main-process changes in PR run memory regression without install checks: %s',
  file => {
    expect(planGates([file], CiEvent.PullRequest, prRef)).toEqual(prPackaging);
  },
);

test.each([
  'src/renderer/services/cowork.ts',
  'src/renderer/services/piUiRecovery.ts',
  'src/renderer/hooks/useSession.ts', // Synthetic path guards the hooks directory policy.
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

test('enterprise toolchain follows the extension diff on pull requests only', () => {
  expect(enterpriseRequired(['docs/readme.md', 'website/index.html'], CiEvent.PullRequest)).toBe(
    false,
  );
  expect(enterpriseRequired(['enterprise/src/index.ts'], CiEvent.PullRequest)).toBe(true);
  expect(enterpriseRequired(['src/main/enterpriseExtension/host.ts'], CiEvent.PullRequest)).toBe(
    true,
  );
  expect(enterpriseRequired(['package.json'], CiEvent.PullRequest)).toBe(true);
  expect(enterpriseRequired(['electron-builder.enterprise.cjs'], CiEvent.PullRequest)).toBe(true);
  expect(enterpriseRequired(['src/renderer/App.tsx'], CiEvent.PullRequest)).toBe(false);
  expect(enterpriseRequired(['docs/readme.md'], CiEvent.Push)).toBe(false);
  expect(enterpriseRequired([], CiEvent.Manual)).toBe(true);
});

test('path-owned checks follow the same diff ownership as the former standalone workflows', () => {
  expect(planPathJobs(['src/main/im/wechat.ts'], CiEvent.PullRequest)).toEqual({
    ...noPathJobs,
    [PathJob.ChannelRuntime]: true,
  });
  expect(planPathJobs(['src/main/pythonRuntime/runner.ts'], CiEvent.PullRequest)).toEqual({
    ...noPathJobs,
    [PathJob.PythonRuntimeLinux]: true,
    [PathJob.PythonRuntimeWindows]: true,
  });
  expect(planPathJobs(['scripts/installer-shell/preview/page.tsx'], CiEvent.PullRequest)).toEqual({
    ...noPathJobs,
    [PathJob.InstallerPreview]: true,
  });
  expect(planPathJobs(['README.md'], CiEvent.PullRequest)).toEqual(noPathJobs);
});

test('manual runs and unknown events fail closed to the complete suite', () => {
  expect(planGates([], CiEvent.Manual, 'refs/heads/main')).toEqual(full);
  expect(planGates([], 'unexpected-event', 'refs/heads/main')).toEqual(full);
});

test('main pushes are light while tag releases retain all heavy checks', () => {
  expect(planGates(['package.json'], CiEvent.Push, 'refs/heads/main')).toEqual(light);
  expect(planGates([], CiEvent.Push, 'refs/tags/v2026.9.5')).toEqual(full);
});

function resultsFor(plan: GatePlan, pathPlan: PathPlan = noPathJobs) {
  const results: Record<string, { result: string }> = Object.fromEntries(
    Object.values(BaselineJob).map(name => [name, { result: JobResult.Success }]),
  );
  for (const [name, enabled] of Object.entries(plan)) {
    results[name] = { result: enabled ? JobResult.Success : JobResult.Skipped };
  }
  for (const [name, enabled] of Object.entries(pathPlan)) {
    results[name] = { result: enabled ? JobResult.Success : JobResult.Skipped };
  }
  return results;
}

test('merge gate permits only intentional skips', () => {
  expect(() => verifyGateResults(light, noPathJobs, resultsFor(light))).not.toThrow();
  expect(() => verifyGateResults(full, noPathJobs, resultsFor(full))).not.toThrow();
});

test.each([JobResult.Failure, JobResult.Cancelled, JobResult.Skipped])(
  'required check %s cannot pass the gate',
  result => {
    for (const name of [...Object.values(BaselineJob), ...Object.values(HeavyJob)]) {
      const results = resultsFor(full);
      results[name] = { result };
      expect(() => verifyGateResults(full, noPathJobs, results)).toThrow();
    }
  },
);

test('missing jobs and incomplete decisions cannot pass the gate', () => {
  const results = resultsFor(full);
  delete results[HeavyJob.Linux];
  expect(() => verifyGateResults(full, noPathJobs, results)).toThrow();
  expect(() => verifyGateResults({} as GatePlan, noPathJobs, resultsFor(light))).toThrow();
});

test('unexpected failure of an optional check cannot be hidden', () => {
  const results = resultsFor(light);
  results[HeavyJob.Memory] = { result: JobResult.Failure };
  expect(() => verifyGateResults(light, noPathJobs, results)).toThrow();
});

interface WorkflowJob {
  needs?: string | string[];
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  outputs?: Record<string, string>;
  strategy?: { 'fail-fast'?: boolean; matrix?: { shard?: number[] } };
  steps?: Array<{ name?: string; run?: string; uses?: string; with?: Record<string, unknown> }>;
}

function workflow(name: string) {
  return load(
    readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8'),
  ) as {
    on: Record<string, unknown>;
    concurrency?: { 'cancel-in-progress'?: boolean };
    jobs: Record<string, WorkflowJob>;
  };
}

test('pull request tests compile Electron once and shard the suite', () => {
  const ci = workflow('ci.yml');
  expect(ci.jobs.test.strategy?.matrix?.shard).toEqual(
    Array.from({ length: TestShardCount }, (_, index) => index + 1),
  );
  expect(ci.jobs.test.strategy?.['fail-fast']).toBe(false);
  expect(ci.jobs.test.needs).toBe(BaselineJob.ElectronCompile);
  const compileCommands = ci.jobs[BaselineJob.ElectronCompile].steps
    ?.map(step => step.run ?? '')
    .join('\n');
  expect(compileCommands).toContain('bun run compile:electron');
  const testCommands = ci.jobs.test.steps?.map(step => step.run ?? '').join('\n');
  expect(testCommands).toContain(`--shard=\${{ matrix.shard }}/${TestShardCount}`);
  expect(testCommands).not.toContain('bun run compile:electron');
  expect(testCommands).toContain('npm test --prefix SKILLs/presentation-studio');
  expect(ci.jobs.enterprise.needs).toBe(BaselineJob.Changes);
  expect(ci.jobs.changes.outputs).toHaveProperty('enterprise');
  expect(ci.jobs.changes.outputs).toHaveProperty('path-plan');
});

test('channel runtime checks live in CI and manual smoke remains dispatch-only', () => {
  const ci = workflow('ci.yml');
  expect(ci.jobs[PathJob.ChannelRuntime].if).toBe(
    `needs.changes.outputs.${PathJob.ChannelRuntime} == 'true'`,
  );
  const smoke = workflow('channel-runtime-smoke.yml');
  expect(smoke.on).toEqual({ workflow_dispatch: null });
  expect(smoke.concurrency?.['cancel-in-progress']).toBe(true);
});

test('CI waits for every selected reusable check and always runs the merge gate', () => {
  const ci = workflow('ci.yml');
  expect(ci.on).toHaveProperty(CiEvent.PullRequest);
  expect(ci.jobs['ci-gate'].name).toBe('ci-gate');
  const gate = ci.jobs['merge-gate'];
  expect(gate.if).toBe('always()');
  expect(gate.needs).toEqual(
    expect.arrayContaining([
      ...Object.values(BaselineJob),
      ...Object.values(HeavyJob),
      ...Object.values(PathJob),
    ]),
  );
  for (const job of Object.values(HeavyJob)) {
    expect(ci.jobs[job].needs).toBe(BaselineJob.Changes);
    expect(ci.jobs[job].if).toBe(`needs.changes.outputs.${job} == 'true'`);
    expect(ci.jobs[job].uses).toMatch(/\.yml$/);
  }
  for (const job of Object.values(PathJob)) {
    expect(ci.jobs[job].needs).toBe(BaselineJob.Changes);
    expect(ci.jobs[job].if).toBe(`needs.changes.outputs.${job} == 'true'`);
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
  // The smoke test must resolve the installed executable from the packaging
  // config: a literal path went stale on the 知远智能体 rename and failed the
  // whole candidate run before any artifact was uploaded.
  expect(steps[install].run).toContain('electron-builder.json');
  expect(steps[install].run).not.toContain("'/opt/知远/知远'");
  expect(workflow('memory-leak-nightly.yml').jobs[HeavyJob.Memory].uses).toBe(memoryJob.uses);
  expect(workflow('memory-leak-nightly.yml').jobs[HeavyJob.Memory].with?.['analyze-heap']).toBe(
    true,
  );
});
