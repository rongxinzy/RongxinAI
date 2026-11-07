import { expect, test } from 'vitest';
import { buildReleaseCandidateAttestation } from './release-candidate-attestation.ts';
import { verifyPreflightAttestationProvenance } from './verify-release-candidate-api.ts';

const repo = 'rongxinzy/RongxinAI';
const sha = 'a'.repeat(40);
const shaOther = 'b'.repeat(40);
const headMain = 'main';

function attestationJson(runId: number, sourceCommit: string, attempt = 1, forgedRunId?: number) {
  const body = buildReleaseCandidateAttestation({
    repository: repo,
    workflowRunId: forgedRunId ?? runId,
    workflowRunAttempt: attempt,
    dispatchRef: 'refs/heads/main',
    workflowHeadSha: 'c'.repeat(40),
    sourceCommit,
    packagingResults: { 'linux-install': 'success', 'windows-install': 'success' },
  });
  return JSON.stringify(body);
}

function run(
  id: number,
  runNumber: number,
  partial: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    run_number: runNumber,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'success',
    head_sha: 'c'.repeat(40),
    head_branch: headMain,
    created_at: `2026-11-07T0${runNumber}:00:00Z`,
    event: 'workflow_dispatch',
    path: '.github/workflows/release-preflight.yml',
    ...partial,
  };
}

function jobsFor(runId: number, sourceCommit: string, packagingSuccess = true) {
  const packagingConclusion = packagingSuccess ? 'success' : 'skipped';
  return {
    jobs: [
      { id: runId * 10 + 1, name: 'source', status: 'completed', conclusion: 'success' },
      {
        id: runId * 10 + 2,
        name: 'preflight-gate',
        status: 'completed',
        conclusion: 'success',
      },
      {
        id: runId * 10 + 3,
        name: 'linux-install',
        status: 'completed',
        conclusion: packagingConclusion,
      },
      {
        id: runId * 10 + 4,
        name: 'windows-install',
        status: 'completed',
        conclusion: packagingConclusion,
      },
    ],
  };
}

function mockClient(handlers: {
  preflightRuns: Record<string, unknown>[];
  artifactsByRun: Record<number, Record<string, unknown>[]>;
  zipByArtifact: Record<number, string>;
  jobsByRun: Record<number, Record<string, unknown>>;
  sourceOutputByJob: Record<number, string>;
}) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      async fetchJson(url: string) {
        calls.push(url);
        if (url.includes('/workflows/ci.yml/runs')) {
          return { workflow_runs: [], total_count: 0 };
        }
        if (url.includes('/workflows/release-preflight.yml/runs')) {
          return {
            workflow_runs: handlers.preflightRuns,
            total_count: handlers.preflightRuns.length,
          };
        }
        const artifactsMatch = url.match(/\/actions\/runs\/(\d+)\/artifacts/);
        if (artifactsMatch) {
          const runId = Number(artifactsMatch[1]);
          return { artifacts: handlers.artifactsByRun[runId] ?? [], total_count: 0 };
        }
        const jobsMatch = url.match(/\/actions\/runs\/(\d+)\/jobs/);
        if (jobsMatch) {
          const runId = Number(jobsMatch[1]);
          return handlers.jobsByRun[runId] ?? { jobs: [] };
        }
        const jobDetailMatch = url.match(/\/actions\/jobs\/(\d+)$/);
        if (jobDetailMatch) {
          const jobId = Number(jobDetailMatch[1]);
          const commit = handlers.sourceOutputByJob[jobId];
          return { outputs: commit ? { commit } : {} };
        }
        throw new Error(`Unexpected fetchJson url: ${url}`);
      },
      async fetchBytes(url: string, maxBytes: number) {
        calls.push(url);
        const match = url.match(/\/artifacts\/(\d+)\/zip/);
        if (!match) throw new Error(`Unexpected fetchBytes url: ${url}`);
        const id = Number(match[1]);
        const text = handlers.zipByArtifact[id];
        if (!text) throw new Error(`Missing zip for artifact ${id}`);
        const bytes = new TextEncoder().encode(text);
        if (bytes.byteLength > maxBytes) throw new Error('zip too large');
        return bytes.buffer;
      },
      unzipMember(zipBytes: ArrayBuffer, memberName: string) {
        const text = new TextDecoder().decode(zipBytes);
        if (memberName !== 'release-candidate-attestation.json') {
          throw new Error(`Refusing to extract ${memberName}`);
        }
        const marker = '::JSON::';
        const index = text.indexOf(marker);
        if (index < 0) throw new Error('malformed unrelated artifact payload');
        return text.slice(index + marker.length);
      },
    },
  };
}

test('accepts attestation only from run-scoped artifact with matching API provenance', async () => {
  const runId = 100;
  const artifactId = 500;
  const zipPayload = `noise::JSON::${attestationJson(runId, sha)}`;
  const { client } = mockClient({
    preflightRuns: [run(100, 5)],
    artifactsByRun: {
      100: [{ id: artifactId, name: 'release-candidate-attestation', workflow_run_id: 100 }],
    },
    zipByArtifact: { [artifactId]: zipPayload },
    jobsByRun: { 100: jobsFor(100, sha) },
    sourceOutputByJob: { 1001: sha },
  });
  const result = await verifyPreflightAttestationProvenance(client, {
    repository: repo,
    sourceCommit: sha,
    maxPreflightRuns: 10,
  });
  expect(result.run.id).toBe(runId);
  expect(result.artifactId).toBe(artifactId);
});

test('rejects forged workflowRunId inside attestation JSON', async () => {
  const runId = 101;
  const artifactId = 501;
  const zipPayload = `::JSON::${attestationJson(runId, sha, 1, 999)}`;
  const { client } = mockClient({
    preflightRuns: [run(101, 6)],
    artifactsByRun: {
      101: [{ id: artifactId, name: 'release-candidate-attestation', workflow_run_id: 101 }],
    },
    zipByArtifact: { [artifactId]: zipPayload },
    jobsByRun: { 101: jobsFor(101, sha) },
    sourceOutputByJob: { 1011: sha },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/workflowRunId/);
});

test('rejects newer failed preflight for the same resolved source commit', async () => {
  const goodArtifact = 601;
  const { client } = mockClient({
    preflightRuns: [
      run(201, 8, { status: 'completed', conclusion: 'failure' }),
      run(200, 7, { status: 'completed', conclusion: 'success' }),
    ],
    artifactsByRun: {
      200: [{ id: goodArtifact, name: 'release-candidate-attestation', workflow_run_id: 200 }],
      201: [],
    },
    zipByArtifact: { [goodArtifact]: `::JSON::${attestationJson(200, sha)}` },
    jobsByRun: {
      200: jobsFor(200, sha),
      201: jobsFor(201, sha),
    },
    sourceOutputByJob: { 2001: sha, 2011: sha },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/Latest Release preflight/);
});

test('rejects in-progress latest preflight for resolved source', async () => {
  const { client } = mockClient({
    preflightRuns: [run(300, 9, { status: 'in_progress', conclusion: null })],
    artifactsByRun: { 300: [] },
    zipByArtifact: {},
    jobsByRun: { 300: jobsFor(300, sha) },
    sourceOutputByJob: { 3001: sha },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/still|in_progress|Latest Release preflight/);
});

test('rejects packaging=false latest run without attestation for source', async () => {
  const { client } = mockClient({
    preflightRuns: [run(400, 10)],
    artifactsByRun: { 400: [] },
    zipByArtifact: {},
    jobsByRun: { 400: jobsFor(400, sha, false) },
    sourceOutputByJob: { 4001: sha },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/no release-candidate-attestation/);
});

test('ignores candidate SHA mismatch via source job output binding', async () => {
  const artifactId = 701;
  const { client } = mockClient({
    preflightRuns: [run(500, 11)],
    artifactsByRun: {
      500: [{ id: artifactId, name: 'release-candidate-attestation', workflow_run_id: 500 }],
    },
    zipByArtifact: { [artifactId]: `::JSON::${attestationJson(500, shaOther)}` },
    jobsByRun: { 500: jobsFor(500, sha) },
    sourceOutputByJob: { 5001: sha },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/sourceCommit/);
});

test('does not download repo-wide artifacts and rejects malformed unrelated payloads', async () => {
  const artifactId = 801;
  const { client, calls } = mockClient({
    preflightRuns: [run(600, 12)],
    artifactsByRun: {
      600: [{ id: artifactId, name: 'release-candidate-attestation', workflow_run_id: 600 }],
    },
    zipByArtifact: { [artifactId]: 'binary noise without json marker' },
    jobsByRun: { 600: jobsFor(600, sha) },
    sourceOutputByJob: { 6001: sha },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/malformed unrelated/);
  expect(calls.some(url => url.includes('/actions/artifacts?'))).toBe(false);
  expect(calls.some(url => url.includes(`/actions/runs/600/artifacts`))).toBe(true);
});

test('skips workflow_dispatch runs from untrusted branches', async () => {
  const { client } = mockClient({
    preflightRuns: [run(700, 13, { head_branch: 'feature/foo' })],
    artifactsByRun: {},
    zipByArtifact: {},
    jobsByRun: {},
    sourceOutputByJob: {},
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/No workflow_dispatch Release preflight run/);
});
