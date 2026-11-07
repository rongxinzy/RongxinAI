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
            { name: 'linux-install', status: 'completed', conclusion: 'success' },
            { name: 'windows-install', status: 'completed', conclusion: 'success' },
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
  const badArtifacts = structuredClone(artifactsFixture);
  const artifacts = badArtifacts.artifacts as Array<Record<string, unknown>>;
  artifacts[0].workflow_run = { id: runId + 1, head_branch: 'main', head_sha: workflowHead };
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
      throw new Error(url);
    },
    async fetchBytes() {
      return new ArrayBuffer(0);
    },
    unzipMember() {
      return '{}';
    },
  };
  await expect(
    verifyPreflightAttestationProvenance(client, { repository: repo, sourceCommit: sha }),
  ).rejects.toThrow(/workflow_run.id/);
});
