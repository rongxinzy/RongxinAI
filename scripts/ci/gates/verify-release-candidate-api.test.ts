import { expect, test } from 'vitest';
import {
  buildPreflightSourceRecord,
  buildReleaseCandidateAttestation,
} from './release-candidate-attestation.ts';
import { verifyPreflightAttestationProvenance } from './verify-release-candidate-api.ts';

const repo = 'rongxinzy/RongxinAI';
const sha = 'a'.repeat(40);
const workflowHead = 'c'.repeat(40);

function records(
  runId: number,
  sourceCommit: string,
  includePackaging = true,
  workflowRunAttempt = 1,
) {
  const source = buildPreflightSourceRecord({
    repository: repo,
    workflowRunId: runId,
    workflowRunAttempt,
    dispatchRef: 'refs/heads/main',
    workflowHeadSha: workflowHead,
    sourceCommit,
    includePackaging,
  });
  const attestation = buildReleaseCandidateAttestation({
    repository: repo,
    workflowRunId: runId,
    workflowRunAttempt,
    dispatchRef: 'refs/heads/main',
    workflowHeadSha: workflowHead,
    sourceCommit,
    packagingResults: { 'linux-install': 'success', 'windows-install': 'success' },
  });
  return { source, attestation };
}

function run(id: number, runNumber: number, partial: Record<string, unknown> = {}) {
  return {
    id,
    run_number: runNumber,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'success',
    head_sha: workflowHead,
    head_branch: 'main',
    created_at: `2026-11-07T0${runNumber}:00:00Z`,
    event: 'workflow_dispatch',
    path: '.github/workflows/release-preflight.yml',
    ...partial,
  };
}

function artifact(id: number, runId: number, name: string) {
  return {
    id,
    name,
    expired: false,
    workflow_run: { id: runId, head_branch: 'main', head_sha: workflowHead },
  };
}

function jobs() {
  return [
    { name: 'source', status: 'completed', conclusion: 'success' },
    { name: 'preflight-gate', status: 'completed', conclusion: 'success' },
    { name: 'linux-install / install-and-start', status: 'completed', conclusion: 'success' },
    { name: 'windows-install / package-and-install', status: 'completed', conclusion: 'success' },
  ];
}

function mockClient(config: {
  runs: Record<string, unknown>[];
  artifacts: Record<number, Array<Record<string, unknown>>>;
  jsonByArtifact: Record<number, string>;
  jobsByRun?: Record<number, unknown[]>;
}) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      async fetchJson(url: string) {
        calls.push(url);
        if (url.includes('/workflows/release-preflight.yml/runs')) {
          return { workflow_runs: config.runs, total_count: config.runs.length };
        }
        const artifactsMatch = url.match(/\/actions\/runs\/(\d+)\/artifacts/);
        if (artifactsMatch) {
          const runId = Number(artifactsMatch[1]);
          return { artifacts: config.artifacts[runId] ?? [], total_count: 0 };
        }
        const attemptJobs = url.match(/\/attempts\/(\d+)\/jobs/);
        if (attemptJobs) {
          const runId = Number(url.match(/\/runs\/(\d+)\//)?.[1]);
          return { jobs: config.jobsByRun?.[runId ?? 0] ?? jobs() };
        }
        throw new Error(`Unexpected fetchJson: ${url}`);
      },
      async fetchBytes(url: string) {
        const match = url.match(/\/artifacts\/(\d+)\/zip/);
        if (!match) throw new Error(`Unexpected fetchBytes: ${url}`);
        const body = config.jsonByArtifact[Number(match[1])] ?? '';
        return new TextEncoder().encode(body).buffer;
      },
      unzipMember(buffer: ArrayBuffer) {
        return new TextDecoder().decode(buffer);
      },
    },
  };
}

test('rejects forged attestation workflowRunId against nested workflow_run binding', async () => {
  const { source, attestation } = records(101, sha);
  const bad = { ...attestation, workflowRunId: 999 };
  const { client } = mockClient({
    runs: [run(101, 6)],
    artifacts: {
      101: [
        artifact(501, 101, 'release-preflight-source'),
        artifact(502, 101, 'release-candidate-attestation'),
      ],
    },
    jsonByArtifact: { 501: JSON.stringify(source), 502: JSON.stringify(bad) },
    jobsByRun: { 101: jobs() },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/workflowRunId/);
});

test('newer failed run with source record blocks stale success', async () => {
  const good = records(200, sha);
  const badSource = records(201, sha);
  const { client } = mockClient({
    runs: [run(201, 8, { conclusion: 'failure' }), run(200, 7)],
    artifacts: {
      200: [
        artifact(601, 200, 'release-preflight-source'),
        artifact(602, 200, 'release-candidate-attestation'),
      ],
      201: [artifact(603, 201, 'release-preflight-source')],
    },
    jsonByArtifact: {
      601: JSON.stringify(good.source),
      602: JSON.stringify(good.attestation),
      603: JSON.stringify(badSource.source),
    },
    jobsByRun: { 200: jobs(), 201: jobs() },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/concluded failure/);
});

for (const failure of ['artifact-list', 'source-download', 'source-extraction'] as const) {
  test(`fails closed on ${failure} for a newer failed preflight`, async () => {
    const good = records(200, sha);
    const failed = records(201, sha);
    const { client, calls } = mockClient({
      runs: [run(201, 8, { conclusion: 'failure' }), run(200, 7)],
      artifacts: {
        200: [
          artifact(601, 200, 'release-preflight-source'),
          artifact(602, 200, 'release-candidate-attestation'),
        ],
        201: [artifact(603, 201, 'release-preflight-source')],
      },
      jsonByArtifact: {
        601: JSON.stringify(good.source),
        602: JSON.stringify(good.attestation),
        603: JSON.stringify(failed.source),
      },
    });
    const error = new Error(`HTTP 503 or unreadable source ZIP: ${failure}`);
    const failingClient = {
      ...client,
      async fetchJson(url: string) {
        if (failure === 'artifact-list' && url.includes('/runs/201/artifacts')) throw error;
        return client.fetchJson(url);
      },
      async fetchBytes(url: string) {
        if (failure === 'source-download' && url.includes('/artifacts/603/zip')) throw error;
        return client.fetchBytes(url);
      },
      unzipMember(buffer: ArrayBuffer) {
        if (failure === 'source-extraction') {
          const record = JSON.parse(new TextDecoder().decode(buffer));
          if (record.workflowRunId === 201) throw error;
        }
        return client.unzipMember(buffer);
      },
    };
    await expect(
      verifyPreflightAttestationProvenance(failingClient, {
        repository: repo,
        sourceCommit: sha,
      }),
    ).rejects.toThrow(error);
    expect(calls.some(url => url.includes('/attempts/1/jobs'))).toBe(false);
  });
}

test('newer in-progress dispatch blocks without downloading repo-wide artifacts', async () => {
  const good = records(300, sha);
  const { client, calls } = mockClient({
    runs: [run(301, 10, { status: 'in_progress', conclusion: null }), run(300, 9)],
    artifacts: {
      300: [
        artifact(701, 300, 'release-preflight-source'),
        artifact(702, 300, 'release-candidate-attestation'),
      ],
      301: [],
    },
    jsonByArtifact: { 701: JSON.stringify(good.source), 702: JSON.stringify(good.attestation) },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/newer than accepted/);
  expect(calls.some(url => url.includes('/actions/artifacts?'))).toBe(false);
});

test('partial rerun without source job on latest attempt fails closed', async () => {
  const good = records(400, sha, true, 2);
  const { client } = mockClient({
    runs: [run(400, 11, { run_attempt: 2 })],
    artifacts: {
      400: [
        artifact(801, 400, 'release-preflight-source'),
        artifact(802, 400, 'release-candidate-attestation'),
      ],
    },
    jsonByArtifact: { 801: JSON.stringify(good.source), 802: JSON.stringify(good.attestation) },
    jobsByRun: { 400: jobs().filter(job => job.name !== 'source') },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/job source must be success/);
});

test('skips unrelated historical source records while selecting latest binding', async () => {
  const good = records(500, sha);
  const stale = records(501, sha).source;
  stale.workflowRunAttempt = 99;
  const { client } = mockClient({
    runs: [run(500, 12), run(501, 11, { run_attempt: 2 })],
    artifacts: {
      500: [
        artifact(901, 500, 'release-preflight-source'),
        artifact(902, 500, 'release-candidate-attestation'),
      ],
      501: [artifact(903, 501, 'release-preflight-source')],
    },
    jsonByArtifact: {
      901: JSON.stringify(good.source),
      902: JSON.stringify(good.attestation),
      903: JSON.stringify(stale),
    },
    jobsByRun: { 500: jobs(), 501: jobs() },
  });
  const result = await verifyPreflightAttestationProvenance(client, {
    repository: repo,
    sourceCommit: sha,
  });
  expect(result.run.id).toBe(500);
});

for (const failure of ['missing', 'expired', 'stale-attempt', 'wrong-schema'] as const) {
  test(`newer failed preflight with ${failure} source cannot reuse older success`, async () => {
    const good = records(600, sha);
    const failed = records(601, sha);
    const sourceArtifact = artifact(1003, 601, 'release-preflight-source');
    const source =
      failure === 'wrong-schema' ? { ...failed.source, schemaVersion: 99 } : failed.source;
    const { client } = mockClient({
      runs: [
        run(601, 14, {
          conclusion: 'failure',
          run_attempt: failure === 'stale-attempt' ? 2 : 1,
        }),
        run(600, 13),
      ],
      artifacts: {
        600: [
          artifact(1001, 600, 'release-preflight-source'),
          artifact(1002, 600, 'release-candidate-attestation'),
        ],
        601: failure === 'missing' ? [] : [{ ...sourceArtifact, expired: failure === 'expired' }],
      },
      jsonByArtifact: {
        1001: JSON.stringify(good.source),
        1002: JSON.stringify(good.attestation),
        1003: JSON.stringify(source),
      },
    });
    await expect(
      verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
    ).rejects.toThrow(/newer than accepted.*source cannot be verified/);
  });
}

test('older missing source does not block a newer verified success', async () => {
  const good = records(700, sha);
  const { client } = mockClient({
    runs: [run(700, 16), run(701, 15, { conclusion: 'failure' })],
    artifacts: {
      700: [
        artifact(1101, 700, 'release-preflight-source'),
        artifact(1102, 700, 'release-candidate-attestation'),
      ],
      701: [],
    },
    jsonByArtifact: {
      1101: JSON.stringify(good.source),
      1102: JSON.stringify(good.attestation),
    },
  });
  const result = await verifyPreflightAttestationProvenance(client, {
    repository: repo,
    sourceCommit: sha,
  });
  expect(result.run.id).toBe(700);
});

test('newer failed preflight verified for another source does not block', async () => {
  const good = records(800, sha);
  const unrelated = records(801, 'b'.repeat(40));
  const { client } = mockClient({
    runs: [run(801, 18, { conclusion: 'failure' }), run(800, 17)],
    artifacts: {
      800: [
        artifact(1201, 800, 'release-preflight-source'),
        artifact(1202, 800, 'release-candidate-attestation'),
      ],
      801: [artifact(1203, 801, 'release-preflight-source')],
    },
    jsonByArtifact: {
      1201: JSON.stringify(good.source),
      1202: JSON.stringify(good.attestation),
      1203: JSON.stringify(unrelated.source),
    },
  });
  const result = await verifyPreflightAttestationProvenance(client, {
    repository: repo,
    sourceCommit: sha,
  });
  expect(result.run.id).toBe(800);
});

test('accepts a complete rerun bound to the current attempt', async () => {
  const good = records(900, sha, true, 2);
  const { client, calls } = mockClient({
    runs: [run(900, 19, { run_attempt: 2 })],
    artifacts: {
      900: [
        artifact(1301, 900, 'release-preflight-source'),
        artifact(1302, 900, 'release-candidate-attestation'),
      ],
    },
    jsonByArtifact: {
      1301: JSON.stringify(good.source),
      1302: JSON.stringify(good.attestation),
    },
    jobsByRun: {
      900: jobs().map(job => ({ ...job, run_attempt: 2 })),
    },
  });
  const result = await verifyPreflightAttestationProvenance(client, {
    repository: repo,
    sourceCommit: sha,
  });
  expect(result.run.id).toBe(900);
  expect(result.run.run_attempt).toBe(2);
  expect(result.artifactId).toBe(1302);
  expect(
    calls.includes(
      'https://api.github.com/repos/rongxinzy/RongxinAI/actions/runs/900/attempts/2/jobs?per_page=100',
    ),
  ).toBe(true);
  expect(calls.some(url => url.includes('/attempts/1/jobs'))).toBe(false);
  expect(calls.some(url => url.includes('/runs/900/jobs'))).toBe(false);
  expect(calls.filter(url => url.endsWith('/runs/900/artifacts?per_page=100')).length).toBe(2);
  expect(calls.some(url => url.includes('/actions/artifacts?'))).toBe(false);
});

test('newer failed preflight with an invalid source SHA cannot reuse older success', async () => {
  const good = records(1000, sha);
  const failed = records(1001, sha);
  const { client } = mockClient({
    runs: [run(1001, 21, { conclusion: 'failure' }), run(1000, 20)],
    artifacts: {
      1000: [
        artifact(1401, 1000, 'release-preflight-source'),
        artifact(1402, 1000, 'release-candidate-attestation'),
      ],
      1001: [artifact(1403, 1001, 'release-preflight-source')],
    },
    jsonByArtifact: {
      1401: JSON.stringify(good.source),
      1402: JSON.stringify(good.attestation),
      1403: JSON.stringify({ ...failed.source, sourceCommit: 'not-a-sha' }),
    },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/newer than accepted.*source cannot be verified/);
});
