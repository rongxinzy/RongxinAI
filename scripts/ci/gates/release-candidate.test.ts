import { expect, test } from 'vitest';
import {
  buildReleaseCandidateAttestation,
  parseReleaseCandidateAttestation,
  RELEASE_CANDIDATE_ATTESTATION_SCHEMA_VERSION,
} from './release-candidate-attestation.ts';
import {
  assertLatestDailyCiPermitsRelease,
  compareWorkflowRunsNewestFirst,
  mergePaginatedPages,
  paginateItemsOrThrow,
  selectLatestWorkflowRun,
  selectNewestValidAttestation,
  type WorkflowRunSummary,
} from './release-candidate.ts';

const shaA = 'a'.repeat(40);
const shaB = 'b'.repeat(40);

function run(
  partial: Partial<WorkflowRunSummary> & Pick<WorkflowRunSummary, 'id'>,
): WorkflowRunSummary {
  return {
    run_number: partial.run_number ?? 1,
    run_attempt: partial.run_attempt ?? 1,
    status: partial.status ?? 'completed',
    conclusion: partial.conclusion ?? 'success',
    head_sha: partial.head_sha ?? shaA,
    created_at: partial.created_at ?? '2026-11-07T00:00:00Z',
    ...partial,
  };
}

test('compareWorkflowRunsNewestFirst prefers higher run_number and attempt', () => {
  const older = run({ id: 1, run_number: 10, created_at: '2026-11-07T02:00:00Z' });
  const newer = run({ id: 2, run_number: 11, created_at: '2026-11-07T01:00:00Z' });
  expect(compareWorkflowRunsNewestFirst(older, newer)).toBeGreaterThan(0);
  const rerun = run({ id: 3, run_number: 11, run_attempt: 2, created_at: '2026-11-07T00:30:00Z' });
  expect(compareWorkflowRunsNewestFirst(newer, rerun)).toBeGreaterThan(0);
});

test('latest CI gate fails when the newest run failed after an older success', () => {
  const runs = [
    run({ id: 1, run_number: 5, conclusion: 'success' }),
    run({ id: 2, run_number: 6, conclusion: 'failure' }),
  ];
  expect(() =>
    assertLatestDailyCiPermitsRelease(
      runs,
      [{ name: 'ci-gate', status: 'completed', conclusion: 'success' }],
      shaA,
    ),
  ).toThrow(/Latest CI run 2/);
});

test('latest CI gate fails when newest attempt is still in progress', () => {
  const runs = [run({ id: 2, run_number: 6, status: 'in_progress', conclusion: null })];
  expect(() => assertLatestDailyCiPermitsRelease(runs, [], shaA)).toThrow(/still in_progress/);
});

test('latest CI gate fails when newest success is missing ci-gate job success', () => {
  const runs = [run({ id: 2, run_number: 6, conclusion: 'success' })];
  expect(() =>
    assertLatestDailyCiPermitsRelease(
      runs,
      [{ name: 'ci-gate', status: 'completed', conclusion: 'failure' }],
      shaA,
    ),
  ).toThrow(/ci-gate/);
});

test('latest CI gate accepts the newest successful run with green ci-gate', () => {
  const runs = [
    run({ id: 1, run_number: 5, conclusion: 'success' }),
    run({ id: 2, run_number: 6, conclusion: 'success' }),
  ];
  expect(
    assertLatestDailyCiPermitsRelease(
      runs,
      [{ name: 'ci-gate', status: 'completed', conclusion: 'success' }],
      shaA,
    ).id,
  ).toBe(2);
});

test('attestation rejects includePackaging=false and skipped packaging', () => {
  expect(() =>
    buildReleaseCandidateAttestation({
      repository: 'owner/repo',
      workflowRunId: 1,
      workflowRunAttempt: 1,
      dispatchRef: 'refs/heads/main',
      workflowHeadSha: shaB,
      sourceCommit: shaA,
      packagingResults: { 'linux-install': 'skipped', 'windows-install': 'success' },
    }),
  ).toThrow(/linux-install/);
  const attestation = buildReleaseCandidateAttestation({
    repository: 'owner/repo',
    workflowRunId: 1,
    workflowRunAttempt: 1,
    dispatchRef: 'refs/heads/main',
    workflowHeadSha: shaB,
    sourceCommit: shaA,
    packagingResults: { 'linux-install': 'success', 'windows-install': 'success' },
  });
  const parsed = JSON.parse(JSON.stringify({ ...attestation, includePackaging: false }));
  expect(() =>
    parseReleaseCandidateAttestation(parsed, { repository: 'owner/repo', sourceCommit: shaA }),
  ).toThrow(/includePackaging/);
});

test('attestation binds sourceCommit not workflow head_sha (dispatch ref mismatch)', () => {
  const attestation = buildReleaseCandidateAttestation({
    repository: 'owner/repo',
    workflowRunId: 9,
    workflowRunAttempt: 1,
    dispatchRef: 'refs/heads/main',
    workflowHeadSha: shaB,
    sourceCommit: shaA,
    packagingResults: { 'linux-install': 'success', 'windows-install': 'success' },
  });
  expect(attestation.workflowHeadSha).toBe(shaB);
  expect(attestation.sourceCommit).toBe(shaA);
  const trusted = parseReleaseCandidateAttestation(attestation, {
    repository: 'owner/repo',
    sourceCommit: shaA,
  });
  expect(trusted.workflowRunId).toBe(9);
  expect(() =>
    parseReleaseCandidateAttestation(attestation, { repository: 'owner/repo', sourceCommit: shaB }),
  ).toThrow(/sourceCommit mismatch/);
});

test('wrong source-ref attestation does not satisfy a different tagged SHA', () => {
  const attestation = buildReleaseCandidateAttestation({
    repository: 'owner/repo',
    workflowRunId: 1,
    workflowRunAttempt: 1,
    dispatchRef: 'refs/heads/main',
    workflowHeadSha: shaA,
    sourceCommit: shaA,
    packagingResults: { 'linux-install': 'success', 'windows-install': 'success' },
  });
  expect(() =>
    parseReleaseCandidateAttestation(attestation, { repository: 'owner/repo', sourceCommit: shaB }),
  ).toThrow(/sourceCommit mismatch/);
});

test('selectNewestValidAttestation prefers newer artifact for the same sourceCommit', () => {
  const chosen = selectNewestValidAttestation(
    [
      {
        sourceCommit: shaA,
        issuedAt: '2026-11-07T01:00:00Z',
        createdAt: '2026-11-07T01:00:00Z',
        id: 1,
      },
      {
        sourceCommit: shaA,
        issuedAt: '2026-11-07T03:00:00Z',
        createdAt: '2026-11-07T03:00:00Z',
        id: 2,
      },
    ],
    shaA,
  );
  expect(chosen?.id).toBe(2);
});

test('mergePaginatedPages preserves order across pages', () => {
  const merged = mergePaginatedPages([
    { items: [1, 2], totalCount: 3 },
    { items: [3], totalCount: 3 },
  ]);
  expect(merged).toEqual([1, 2, 3]);
});

test('selectLatestWorkflowRun returns null on empty input', () => {
  expect(selectLatestWorkflowRun([])).toBeNull();
});

test('parseReleaseCandidateAttestation rejects unsupported schema versions', () => {
  expect(() =>
    parseReleaseCandidateAttestation(
      { schemaVersion: RELEASE_CANDIDATE_ATTESTATION_SCHEMA_VERSION + 1 },
      { repository: 'owner/repo', sourceCommit: shaA },
    ),
  ).toThrow(/schemaVersion/);
});

test('paginateItemsOrThrow fails closed on malformed API pages', () => {
  expect(() => paginateItemsOrThrow([{ items: [1] }, {}])).toThrow(/missing items array/);
});
