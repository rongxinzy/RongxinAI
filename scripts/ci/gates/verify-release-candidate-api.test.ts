import { expect, test } from 'vitest';
import {
  PREFLIGHT_SOURCE_RECORD_FILE,
  buildPreflightSourceRecord,
  buildReleaseCandidateAttestation,
} from './release-candidate-attestation.ts';
import { verifyPreflightAttestationProvenance } from './verify-release-candidate-api.ts';

const repo = 'rongxinzy/RongxinAI';
const sha = 'a'.repeat(40);
const headMain = 'main';
const workflowHead = 'c'.repeat(40);

function attestationJson(runId: number, sourceCommit: string, forgedRunId?: number) {
  return JSON.stringify(
    buildReleaseCandidateAttestation({
      repository: repo,
      workflowRunId: forgedRunId ?? runId,
      workflowRunAttempt: 1,
      dispatchRef: 'refs/heads/main',
      workflowHeadSha: workflowHead,
      sourceCommit,
      packagingResults: { 'linux-install': 'success', 'windows-install': 'success' },
    }),
  );
}

function sourceJson(runId: number, sourceCommit: string, includePackaging = true) {
  return JSON.stringify(
    buildPreflightSourceRecord({
      repository: repo,
      workflowRunId: runId,
      workflowRunAttempt: 1,
      dispatchRef: 'refs/heads/main',
      workflowHeadSha: workflowHead,
      sourceCommit,
      includePackaging,
    }),
  );
}

function run(id: number, runNumber: number, partial: Record<string, unknown> = {}) {
  return {
    id,
    run_number: runNumber,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'success',
    head_sha: workflowHead,
    head_branch: headMain,
    created_at: `2026-11-07T0${runNumber}:00:00Z`,
    event: 'workflow_dispatch',
    path: '.github/workflows/release-preflight.yml',
    ...partial,
  };
}

function jobsFor(packagingSuccess = true) {
  const packagingConclusion = packagingSuccess ? 'success' : 'skipped';
  return {
    jobs: [
      { name: 'preflight-gate', status: 'completed', conclusion: 'success' },
      { name: 'linux-install', status: 'completed', conclusion: packagingConclusion },
      { name: 'windows-install', status: 'completed', conclusion: packagingConclusion },
    ],
  };
}

function mockClient(handlers: {
  preflightRuns: Record<string, unknown>[];
  artifactsByRun: Record<number, Array<Record<string, unknown>>>;
  zipPayload: Record<string, string>;
  jobsByRun: Record<number, Record<string, unknown>>;
}) {
  const calls: string[] = [];
  let artifactSeq = 7000;
  const artifactIndex: Record<number, { id: number; name: string; workflow_run_id: number }> = {};
  for (const [runId, artifacts] of Object.entries(handlers.artifactsByRun)) {
    for (const artifact of artifacts) {
      const id = artifactSeq++;
      artifactIndex[id] = {
        id,
        name: String(artifact.name),
        workflow_run_id: Number(runId),
      };
    }
  }
  return {
    calls,
    client: {
      async fetchJson(url: string) {
        calls.push(url);
        if (url.includes('/workflows/ci.yml/runs')) return { workflow_runs: [], total_count: 0 };
        if (url.includes('/workflows/release-preflight.yml/runs')) {
          return {
            workflow_runs: handlers.preflightRuns,
            total_count: handlers.preflightRuns.length,
          };
        }
        const artifactsMatch = url.match(/\/actions\/runs\/(\d+)\/artifacts/);
        if (artifactsMatch) {
          const runId = Number(artifactsMatch[1]);
          const artifacts = (handlers.artifactsByRun[runId] ?? []).map(artifact => {
            const entry = Object.values(artifactIndex).find(
              item => item.workflow_run_id === runId && item.name === artifact.name,
            );
            return { ...artifact, id: entry?.id, workflow_run_id: runId, expired: false };
          });
          return { artifacts, total_count: artifacts.length };
        }
        const jobsMatch = url.match(/\/actions\/runs\/(\d+)\/jobs/);
        if (jobsMatch) {
          const runId = Number(jobsMatch[1]);
          return handlers.jobsByRun[runId] ?? { jobs: [] };
        }
        throw new Error(`Unexpected fetchJson: ${url}`);
      },
      async fetchBytes(url: string, maxBytes: number) {
        calls.push(url);
        const match = url.match(/\/artifacts\/(\d+)\/zip/);
        if (!match) throw new Error(`Unexpected fetchBytes: ${url}`);
        const id = Number(match[1]);
        const meta = artifactIndex[id];
        const key = `${meta.workflow_run_id}:${meta.name}`;
        const payload = handlers.zipPayload[key];
        if (!payload) throw new Error(`Missing zip payload for ${key}`);
        const bytes = new TextEncoder().encode(payload);
        if (bytes.byteLength > maxBytes) throw new Error('zip too large');
        return bytes.buffer;
      },
      unzipMember(zipBytes: ArrayBuffer, memberName: string) {
        const text = new TextDecoder().decode(zipBytes);
        const marker = '::JSON::';
        const markerIndex = text.indexOf(marker);
        if (markerIndex < 0) throw new Error(`Refusing malformed artifact member ${memberName}`);
        return text.slice(markerIndex + marker.length);
      },
    },
  };
}

function zipPayload(runId: number, source: string, attestation: string) {
  return {
    [`${runId}:release-preflight-source`]: `::JSON::${source}`,
    [`${runId}:release-candidate-attestation`]: `::JSON::${attestation}`,
  };
}

test('accepts run-scoped source record plus attestation with API metadata', async () => {
  const { client } = mockClient({
    preflightRuns: [run(100, 5)],
    artifactsByRun: {
      100: [{ name: 'release-preflight-source' }, { name: 'release-candidate-attestation' }],
    },
    zipPayload: zipPayload(100, sourceJson(100, sha), attestationJson(100, sha)),
    jobsByRun: { 100: jobsFor(true) },
  });
  const result = await verifyPreflightAttestationProvenance(client, {
    repository: repo,
    sourceCommit: sha,
  });
  expect(result.run.id).toBe(100);
});

test('rejects forged attestation workflowRunId', async () => {
  const { client } = mockClient({
    preflightRuns: [run(101, 6)],
    artifactsByRun: {
      101: [{ name: 'release-preflight-source' }, { name: 'release-candidate-attestation' }],
    },
    zipPayload: zipPayload(101, sourceJson(101, sha), attestationJson(101, sha, 999)),
    jobsByRun: { 101: jobsFor(true) },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/workflowRunId/);
});

test('rejects newer failed preflight for same source record SHA', async () => {
  const { client } = mockClient({
    preflightRuns: [run(201, 8, { status: 'completed', conclusion: 'failure' }), run(200, 7)],
    artifactsByRun: {
      200: [{ name: 'release-preflight-source' }, { name: 'release-candidate-attestation' }],
      201: [{ name: 'release-preflight-source' }],
    },
    zipPayload: {
      ...zipPayload(200, sourceJson(200, sha), attestationJson(200, sha)),
      '201:release-preflight-source': `::JSON::${sourceJson(201, sha)}`,
    },
    jobsByRun: { 200: jobsFor(true), 201: jobsFor(true) },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/concluded failure/);
});

test('rejects newer in-progress dispatch before source resolution completes', async () => {
  const { client } = mockClient({
    preflightRuns: [run(301, 10, { status: 'in_progress', conclusion: null }), run(300, 9)],
    artifactsByRun: {
      300: [{ name: 'release-preflight-source' }, { name: 'release-candidate-attestation' }],
      301: [],
    },
    zipPayload: zipPayload(300, sourceJson(300, sha), attestationJson(300, sha)),
    jobsByRun: { 300: jobsFor(true) },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/newer than accepted/);
});

test('rejects include-packaging=false source record even if attestation existed', async () => {
  const { client } = mockClient({
    preflightRuns: [run(400, 11)],
    artifactsByRun: { 400: [{ name: 'release-preflight-source' }] },
    zipPayload: { '400:release-preflight-source': `::JSON::${sourceJson(400, sha, false)}` },
    jobsByRun: { 400: jobsFor(false) },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/include-packaging=false/);
});

test('ignores source record for other SHAs and never lists repo-wide artifacts', async () => {
  const { client, calls } = mockClient({
    preflightRuns: [run(500, 12)],
    artifactsByRun: {
      500: [{ name: 'release-preflight-source' }],
    },
    zipPayload: { '500:release-preflight-source': `::JSON::${sourceJson(500, 'b'.repeat(40))}` },
    jobsByRun: { 500: jobsFor(true) },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/release-preflight-source artifact for/);
  expect(calls.some(url => url.includes('/actions/artifacts?'))).toBe(false);
  expect(calls.some(url => url.includes(`/actions/runs/500/artifacts`))).toBe(true);
});

test('rejects malformed unrelated artifact payloads without full extraction', async () => {
  const { client } = mockClient({
    preflightRuns: [run(600, 13)],
    artifactsByRun: {
      600: [{ name: 'release-preflight-source' }, { name: 'release-candidate-attestation' }],
    },
    zipPayload: {
      '600:release-preflight-source': `::JSON::${sourceJson(600, sha)}`,
      '600:release-candidate-attestation': 'not-json',
    },
    jobsByRun: { 600: jobsFor(true) },
  });
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow();
  expect(PREFLIGHT_SOURCE_RECORD_FILE).toBe('release-preflight-source.json');
});
