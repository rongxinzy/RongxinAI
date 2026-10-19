import { readFileSync } from 'node:fs';
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
