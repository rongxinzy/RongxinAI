import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  assertArtifactBoundToRun,
  parseRunArtifacts,
  parseWorkflowJobs,
  parseWorkflowRuns,
} from './github-rest.ts';

test('recorded job REST fixture has steps but no outputs', () => {
  const job = JSON.parse(
    readFileSync('scripts/ci/gates/fixtures/github-rest-actions-job-200.json', 'utf8'),
  ) as Record<string, unknown>;
  expect(job).toHaveProperty('steps');
  expect(job).not.toHaveProperty('outputs');
});

test('recorded run-artifacts fixture uses nested workflow_run only', () => {
  const payload = JSON.parse(
    readFileSync('scripts/ci/gates/fixtures/github-rest-run-artifacts-200.json', 'utf8'),
  ) as Record<string, unknown>;
  const artifacts = parseRunArtifacts(payload);
  expect(artifacts[0]).not.toHaveProperty('workflow_run_id');
  expect(artifacts[0].workflow_run?.id).toBe(9001);
  assertArtifactBoundToRun(artifacts[0], 9001);
  expect(() => assertArtifactBoundToRun(artifacts[0], 9002)).toThrow(/workflow_run.id/);
});

test('recorded reusable-workflow jobs use caller / callee names', () => {
  const payload = JSON.parse(
    readFileSync('scripts/ci/gates/fixtures/github-rest-reusable-workflow-jobs-200.json', 'utf8'),
  ) as Record<string, unknown>;
  const jobs = parseWorkflowJobs(payload);
  expect(jobs.some(job => job.name === 'prepare-release')).toBe(true);
  expect(jobs.some(job => job.name.startsWith('build-linux /'))).toBe(true);
  expect(jobs.some(job => job.name === 'linux-install')).toBe(false);
});

test('recorded preflight attempt jobs use reusable packaging names', () => {
  const payload = JSON.parse(
    readFileSync(
      'scripts/ci/gates/fixtures/github-rest-preflight-attempt-jobs-42340332484.json',
      'utf8',
    ),
  ) as Record<string, unknown>;
  const jobs = parseWorkflowJobs(payload);
  expect(jobs.some(job => job.name === 'linux-install / install-and-start')).toBe(true);
  expect(jobs.some(job => job.name === 'windows-install / package-and-install')).toBe(true);
  expect(jobs.some(job => job.name === 'linux-install')).toBe(false);
});

test('recorded workflow run and jobs fixtures parse for verifier transport', () => {
  const run = JSON.parse(
    readFileSync('scripts/ci/gates/fixtures/github-rest-workflow-run-200.json', 'utf8'),
  ) as Record<string, unknown>;
  const runsPage = JSON.parse(
    readFileSync('scripts/ci/gates/fixtures/github-rest-workflow-runs-page-200.json', 'utf8'),
  ) as Record<string, unknown>;
  const jobs = JSON.parse(
    readFileSync('scripts/ci/gates/fixtures/github-rest-workflow-jobs-200.json', 'utf8'),
  ) as Record<string, unknown>;
  expect(parseWorkflowRuns(runsPage)[0]?.id).toBe(run.id);
  expect(parseWorkflowJobs(jobs).some(job => job.name === 'ci-gate')).toBe(true);
});
