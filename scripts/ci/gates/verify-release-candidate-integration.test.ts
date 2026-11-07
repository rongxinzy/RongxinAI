import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  buildPreflightSourceRecord,
  buildReleaseCandidateAttestation,
} from './release-candidate-attestation.ts';
import { verifyPreflightAttestationProvenance } from './verify-release-candidate-api.ts';

const repo = 'rongxinzy/RongxinAI';
const sha = 'd'.repeat(40);
const workflowHead = 'c'.repeat(40);
const runId = 9001;

const artifactsFixture = JSON.parse(
  readFileSync('scripts/ci/gates/fixtures/github-rest-run-artifacts-200.json', 'utf8'),
) as Record<string, unknown>;

function payload(runPartial: Record<string, unknown> = {}) {
  const source = buildPreflightSourceRecord({
    repository: repo,
    workflowRunId: runId,
    workflowRunAttempt: 1,
    dispatchRef: 'refs/heads/main',
    workflowHeadSha: workflowHead,
    sourceCommit: sha,
    includePackaging: true,
  });
  const attestation = buildReleaseCandidateAttestation({
    repository: repo,
    workflowRunId: runId,
    workflowRunAttempt: 1,
    dispatchRef: 'refs/heads/main',
    workflowHeadSha: workflowHead,
    sourceCommit: sha,
    packagingResults: { 'linux-install': 'success', 'windows-install': 'success' },
  });
  return {
    source: JSON.stringify(source),
    attestation: JSON.stringify(attestation),
    ...runPartial,
  };
}

test('positive integration uses recorded artifact REST shape with nested workflow_run', async () => {
  const pl = payload();
  const preflightRun = {
    id: runId,
    run_number: 42,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'success',
    head_sha: workflowHead,
    head_branch: 'main',
    created_at: '2026-11-07T04:00:00Z',
    event: 'workflow_dispatch',
    path: '.github/workflows/release-preflight.yml',
  };
  const zip = new Map<number, { source: string; attestation: string }>([
    [41000001, { source: pl.source, attestation: '' }],
    [41000002, { source: '', attestation: pl.attestation }],
  ]);
  const client = {
    async fetchJson(url: string) {
      if (url.includes('/workflows/release-preflight.yml/runs')) {
        return { workflow_runs: [preflightRun], total_count: 1 };
      }
      if (url.includes(`/actions/runs/${runId}/artifacts`)) {
        return artifactsFixture;
      }
      if (url.includes(`/attempts/1/jobs`)) {
        return {
          jobs: [
            { name: 'source', status: 'completed', conclusion: 'success' },
            { name: 'preflight-gate', status: 'completed', conclusion: 'success' },
            {
              name: 'linux-install / install-and-start',
              status: 'completed',
              conclusion: 'success',
            },
            {
              name: 'windows-install / package-and-install',
              status: 'completed',
              conclusion: 'success',
            },
          ],
        };
      }
      throw new Error(`unexpected url ${url}`);
    },
    async fetchBytes(url: string, maxBytes: number) {
      const match = url.match(/artifacts\/(\d+)\/zip/);
      if (!match) throw new Error(`unexpected fetchBytes ${url}`);
      const id = Number(match[1]);
      const entry = zip.get(id);
      if (!entry) throw new Error(`missing zip ${id}`);
      const body = id === 41000001 ? entry.source : entry.attestation;
      const bytes = new TextEncoder().encode(body);
      if (bytes.byteLength > maxBytes) throw new Error('too large');
      return bytes.buffer;
    },
    unzipMember(buffer: ArrayBuffer, member: string) {
      const text = new TextDecoder().decode(buffer);
      if (!member.endsWith('.json')) throw new Error('bad member');
      return text;
    },
  };
  const result = await verifyPreflightAttestationProvenance(client, {
    repository: repo,
    sourceCommit: sha,
    maxPreflightRuns: 5,
  });
  expect(result.run.id).toBe(runId);
  expect(result.artifactId).toBe(41000002);
});

test('rejects attestation when nested workflow_run.id disagrees with run listing', async () => {
  const pl = payload();
  const badArtifacts = structuredClone(artifactsFixture);
  const artifacts = badArtifacts.artifacts as Array<Record<string, unknown>>;
  const attestationEntry = artifacts.find(
    entry => (entry as { name?: string }).name === 'release-candidate-attestation',
  ) as { workflow_run?: { id: number } };
  attestationEntry.workflow_run = { id: runId + 1, head_branch: 'main', head_sha: workflowHead };
  const client = {
    async fetchJson(url: string) {
      if (url.includes('/workflows/release-preflight.yml/runs')) {
        return {
          workflow_runs: [
            {
              id: runId,
              run_number: 42,
              run_attempt: 1,
              status: 'completed',
              conclusion: 'success',
              head_sha: workflowHead,
              head_branch: 'main',
              created_at: '2026-11-07T04:00:00Z',
              event: 'workflow_dispatch',
              path: '.github/workflows/release-preflight.yml',
            },
          ],
        };
      }
      if (url.includes('/artifacts')) return badArtifacts;
      if (url.includes('/attempts/1/jobs')) {
        return {
          jobs: [
            { name: 'source', status: 'completed', conclusion: 'success' },
            { name: 'preflight-gate', status: 'completed', conclusion: 'success' },
            {
              name: 'linux-install / install-and-start',
              status: 'completed',
              conclusion: 'success',
            },
            {
              name: 'windows-install / package-and-install',
              status: 'completed',
              conclusion: 'success',
            },
          ],
        };
      }
      throw new Error(url);
    },
    async fetchBytes(url: string) {
      const match = url.match(/artifacts\/(\d+)\/zip/);
      if (!match) throw new Error(url);
      const id = Number(match[1]);
      const body = id === 41000001 ? pl.source : id === 41000002 ? pl.attestation : '';
      return new TextEncoder().encode(body).buffer;
    },
    unzipMember(buffer: ArrayBuffer, member: string) {
      const text = new TextDecoder().decode(buffer);
      if (!member.endsWith('.json')) throw new Error('bad member');
      return text;
    },
  };
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/workflow_run.id/);
});

test('recorded preflight run 42340332484 blocks release at failed run conclusion', async () => {
  const sha = '977abbf023dfb8cbb3cf998b1d4e09e66ec86655';
  const branchHead = sha;
  const runId = 42340332484;
  const sourceRecord = JSON.parse(
    readFileSync(
      'scripts/ci/gates/fixtures/release-preflight-source-42340332484.json',
      'utf8',
    ),
  );
  const artifactsPayload = JSON.parse(
    readFileSync(
      'scripts/ci/gates/fixtures/github-rest-preflight-run-artifacts-42340332484.json',
      'utf8',
    ),
  ) as Record<string, unknown>;
  const attemptJobs = JSON.parse(
    readFileSync(
      'scripts/ci/gates/fixtures/github-rest-preflight-attempt-jobs-42340332484.json',
      'utf8',
    ),
  );
  const client = {
    async fetchJson(url: string) {
      if (url.includes('/workflows/release-preflight.yml/runs')) {
        return {
          workflow_runs: [
            {
              id: runId,
              run_number: 1,
              run_attempt: 1,
              status: 'completed',
              conclusion: 'failure',
              head_sha: branchHead,
              head_branch: 'release/validation-ci-gates-1778',
              created_at: '2026-11-07T04:52:00Z',
              event: 'workflow_dispatch',
              path: '.github/workflows/release-preflight.yml',
            },
          ],
        };
      }
      if (url.includes(`/actions/runs/${runId}/artifacts`)) return artifactsPayload;
      if (url.includes('/attempts/1/jobs')) return attemptJobs;
      throw new Error(`unexpected url ${url}`);
    },
    async fetchBytes(url: string) {
      if (!url.includes('/artifacts/13560394788/zip')) throw new Error(url);
      return new TextEncoder().encode(JSON.stringify(sourceRecord)).buffer;
    },
    unzipMember(buffer: ArrayBuffer) {
      return new TextDecoder().decode(buffer);
    },
  };
  await expect(
    verifyPreflightAttestationProvenance(client, {
      repository: 'rongxinzy/RongxinAI',
      sourceCommit: sha,
    }),
  ).rejects.toThrow(/concluded failure/);
});
