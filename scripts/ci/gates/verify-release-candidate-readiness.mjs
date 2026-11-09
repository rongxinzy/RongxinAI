#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RELEASE_CANDIDATE_ATTESTATION_FILE } from './release-candidate-attestation.ts';
import { verifyReleaseCandidateReadiness } from './verify-release-candidate-api.ts';

const commit = process.env.SOURCE_COMMIT ?? '';
const repository = process.env.GITHUB_REPOSITORY ?? '';
const token = process.env.GITHUB_TOKEN ?? '';

if (!/^[0-9a-f]{40}$/.test(commit)) {
  console.error('[ReleaseCandidate] SOURCE_COMMIT must be a full Git SHA');
  process.exit(1);
}
if (!repository || !token) {
  console.error('[ReleaseCandidate] GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  process.exit(1);
}

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
};

function createClient() {
  return {
    async fetchJson(url) {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`GitHub API ${response.status} for ${url}: ${body}`);
      }
      return response.json();
    },
    async fetchBytes(url, maxBytes) {
      const response = await fetch(url, { headers, redirect: 'follow' });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Artifact download failed with ${response.status}: ${body}`);
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > maxBytes) {
        throw new Error(`Artifact zip exceeds ${maxBytes} bytes`);
      }
      return buffer;
    },
    unzipMember(zipBytes, memberName, maxMemberBytes) {
      const dir = mkdtempSync(join(tmpdir(), 'release-candidate-attest-'));
      const zipPath = join(dir, 'attestation.zip');
      try {
        writeFileSync(zipPath, Buffer.from(zipBytes));
        const text = execFileSync('unzip', ['-p', zipPath, memberName], {
          encoding: 'utf8',
          maxBuffer: maxMemberBytes,
        });
        return text;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

try {
  const result = await verifyReleaseCandidateReadiness(createClient(), {
    repository,
    sourceCommit: commit,
  });
  console.log(
    `[ReleaseCandidate] ci run ${result.ciRunId}; preflight run ${result.preflightRunId}; artifact ${result.artifactId} permit ${commit}`,
  );
} catch (error) {
  console.error('[ReleaseCandidate] readiness verification failed:', error);
  process.exit(1);
}
