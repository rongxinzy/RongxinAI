import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';

type Step = {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
};
type Job = {
  needs?: string | string[];
  steps: Step[];
  strategy?: { 'fail-fast': unknown };
  with?: Record<string, unknown>;
};
const read = (file: string) =>
  load(readFileSync(`.github/workflows/${file}`, 'utf8')) as { jobs: Record<string, Job> };

test('acceptance downloads the checkpoint and never rebuilds or signs installers', () => {
  const { build, acceptance, 'cuda-runtime': cuda } = read('build-inference-editions.yml').jobs;
  expect(acceptance.needs).toContain('build');
  expect(acceptance.strategy?.['fail-fast']).toBe(false);
  expect(cuda.needs).toBe('plan-matrix');
  expect(
    build.steps.some(step => step.run?.includes('checkpoint.mjs create package-checkpoint')),
  ).toBe(true);
  expect(build.steps.some(step => step.run?.includes('windows-installer-smoke.ps1'))).toBe(false);
  expect(
    acceptance.steps.some(step => step.run?.includes('checkpoint.mjs restore package-checkpoint')),
  ).toBe(true);
  expect(acceptance.steps.map(step => step.run ?? '').join('\n')).not.toMatch(
    /bun run (?:build|dist|package)|electron-builder --|setup-certum-signing/,
  );
  const release = read('release.yml').jobs;
  expect(release.publish.needs).toEqual(
    expect.arrayContaining(['quality', 'memory-regression', 'build-release']),
  );
  expect(release['build-release'].with?.['fail-fast']).toBe(false);
});

test('a Windows size error cannot be overwritten by a later native command', () => {
  for (const [file, job] of [
    ['build-inference-editions.yml', 'acceptance'],
    ['enterprise-windows.yml', 'package'],
  ]) {
    const step = read(file).jobs[job].steps.find(item =>
      item.run?.includes('-File scripts/ci/windows-installer-size-smoke.ps1'),
    )!;
    expect(step).toBeDefined();
    const command = step.run!;
    const check = command.indexOf('if ($LASTEXITCODE -ne 0)');
    expect(check).toBeGreaterThan(command.indexOf('windows-installer-size-smoke.ps1'));
    if (command.includes('windows-runtime-smoke.ps1'))
      expect(check).toBeLessThan(command.indexOf('windows-runtime-smoke.ps1'));
  }
});

test('compression qualification overlaps packaging and is bound before acceptance', () => {
  const jobs = read('build-inference-editions.yml').jobs;
  expect(jobs['windows-components'].needs).toBe('plan-matrix');
  expect(jobs['compression-qualification'].needs).toBe('windows-components');
  expect(jobs.build.needs).toContain('windows-components');
  expect(jobs.build.needs).not.toContain('compression-qualification');
  expect(jobs.acceptance.needs).toContain('compression-qualification');
  const steps = jobs.acceptance.steps;
  const restore = steps.findIndex(step => step.run?.includes('restore package-checkpoint'));
  const report = steps.findIndex(
    step => step.with?.name === 'windows-compression-common-${{ github.run_id }}',
  );
  const verify = steps.findIndex(
    step => step.run === 'node scripts/ci/compression-qualification.cjs verify',
  );
  expect(report).toBeGreaterThan(restore);
  expect(verify).toBeGreaterThan(report);
});

test('directory smoke cannot bypass release or extended installer acceptance', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'matrix-plan-'));
  try {
    const plan = read('build-inference-editions.yml').jobs['plan-matrix'].steps[0].run!;
    const run = (mode: string, directoryOnly: boolean, extended: boolean) =>
      spawnSync('bash', ['-e', '-o', 'pipefail', '-c', plan], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: path.join(root, 'outputs'),
          BUILD_MODE: mode,
          LINUX_DIRECTORY_ONLY: String(directoryOnly),
          EXTENDED_INSTALL_TESTS: String(extended),
          BUILD_LINUX: 'true',
          BUILD_WINDOWS: 'false',
          BUILD_MACOS: 'false',
          LINUX_INFERENCE_EDITIONS: 'cpu',
        },
      });
    expect(run('verify', true, false).status).toBe(0);
    expect(run('release', true, false).status).not.toBe(0);
    expect(run('verify', true, true).status).not.toBe(0);
    expect(run('release', false, true).status).toBe(0);
    expect(run('invalid', false, false).status).not.toBe(0);
    expect(read('ci.yml').jobs['build-verification'].with?.['linux-directory-only']).toBe(true);
    expect(
      read('linux-install-pr.yml').jobs['install-and-start'].with?.['linux-directory-only'],
    ).not.toBe(true);
    expect(
      read('build-platforms.yml').jobs['verify-inference-editions'].with?.['linux-directory-only'],
    ).not.toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
