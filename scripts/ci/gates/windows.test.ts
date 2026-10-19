import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  'continue-on-error'?: boolean;
  with?: Record<string, unknown>;
}

interface Workflow {
  on: Record<string, unknown>;
  jobs: Record<string, { steps: Step[] }>;
}

function workflow(file: string): Workflow {
  return load(
    readFileSync(new URL(`../../../.github/workflows/${file}`, import.meta.url), 'utf8'),
  ) as Workflow;
}

const compressionAction = './.github/actions/verify-windows-compression';
test('manual install workflows share the edition pipeline and retain their extended acceptance', () => {
  const windows = workflow('windows-installer-pr.yml');
  expect(windows.on).toHaveProperty('schedule');
  expect(windows.on).toHaveProperty('workflow_dispatch');
  expect(windows.on).toHaveProperty('workflow_call');
  expect(windows.on).not.toHaveProperty('pull_request');
  for (const [file, name] of [
    ['windows-installer-pr.yml', 'package-and-install'],
    ['linux-install-pr.yml', 'install-and-start'],
  ]) {
    const job = workflow(file).jobs[name] as unknown as {
      uses: string;
      with: Record<string, unknown>;
    };
    expect(job.uses).toBe('./.github/workflows/build-inference-editions.yml');
    expect(job.with['extended-install-tests']).toBe(true);
  }
  const acceptance = workflow('build-inference-editions.yml').jobs.acceptance.steps;
  for (const script of ['windows-installer-smoke.ps1', 'windows-installer-interactive.ps1']) {
    const gate = acceptance.find(step => step.run?.includes(script));
    expect(gate?.if).toContain('inputs.extended-install-tests');
    expect(gate?.['continue-on-error']).toBeUndefined();
  }
});

test('one compression producer gates packaging and acceptance validates its exact bytes', () => {
  const editions = workflow('build-inference-editions.yml');
  expect(
    editions.jobs['windows-components'].steps.some(step => step.uses === compressionAction),
  ).toBe(true);
  expect(editions.jobs.build.steps.some(step => step.uses === compressionAction)).toBe(false);
  const acceptance = editions.jobs.acceptance.steps;
  const verification = acceptance.findIndex(
    step => step.run === 'node scripts/ci/compression-qualification.cjs verify',
  );
  expect(verification).toBeGreaterThan(-1);
  expect(acceptance[verification]['continue-on-error']).toBeUndefined();
  expect(
    acceptance.findIndex(step => step.name === 'Assemble Windows release payload'),
  ).toBeGreaterThan(verification);
});

test('shared qualification fails on thresholds and retains reports without hiding failure', () => {
  const action = load(
    readFileSync(
      new URL('../../../.github/actions/verify-windows-compression/action.yml', import.meta.url),
      'utf8',
    ),
  ) as { runs: { steps: Step[] } };
  const benchmark = action.runs.steps.find(step => step.run?.includes('-RequireQualified'));
  expect(benchmark).toBeDefined();
  expect(benchmark?.run).not.toContain('-SkipPythonProbe');
  expect(action.runs.steps.every(step => !step['continue-on-error'])).toBe(true);
  const upload = action.runs.steps.find(step => step.uses === 'actions/upload-artifact@v6');
  expect(upload?.if).toBe('always()');
  expect(upload?.with?.['retention-days']).toBe(3);
});
