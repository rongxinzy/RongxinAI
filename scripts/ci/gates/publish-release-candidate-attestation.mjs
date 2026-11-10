#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { PackagingJob } from './constants.ts';
import {
  RELEASE_CANDIDATE_ATTESTATION_FILE,
  buildReleaseCandidateAttestation,
} from './release-candidate-attestation.ts';

const includePackaging = process.env.INCLUDE_PACKAGING;
const results = JSON.parse(process.env.PREFLIGHT_RESULTS ?? '{}');
const repository = process.env.GITHUB_REPOSITORY ?? '';
const sourceCommit = process.env.SOURCE_COMMIT ?? '';
const dispatchRef = process.env.GITHUB_REF ?? '';
const workflowHeadSha = process.env.GITHUB_SHA ?? '';
const workflowRunId = Number(process.env.GITHUB_RUN_ID);
const workflowRunAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);

if (includePackaging !== 'true') {
  console.error('[ReleaseCandidateAttestation] INCLUDE_PACKAGING must be true to publish');
  process.exit(1);
}
if (!repository || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
  console.error('[ReleaseCandidateAttestation] repository and SOURCE_COMMIT are required');
  process.exit(1);
}
if (!Number.isInteger(workflowRunId) || !Number.isInteger(workflowRunAttempt)) {
  console.error('[ReleaseCandidateAttestation] workflow run metadata is required');
  process.exit(1);
}

const packagingResults = Object.fromEntries(
  Object.values(PackagingJob).map(name => [name, results[name]?.result ?? 'missing']),
);

try {
  const attestation = buildReleaseCandidateAttestation({
    repository,
    workflowRunId,
    workflowRunAttempt,
    dispatchRef,
    workflowHeadSha,
    sourceCommit,
    packagingResults,
  });
  writeFileSync(RELEASE_CANDIDATE_ATTESTATION_FILE, `${JSON.stringify(attestation, null, 2)}\n`);
  console.log(
    `[ReleaseCandidateAttestation] wrote ${RELEASE_CANDIDATE_ATTESTATION_FILE} for source ${sourceCommit} (workflow head ${workflowHeadSha}, dispatch ${dispatchRef})`,
  );
} catch (error) {
  console.error('[ReleaseCandidateAttestation] publish failed:', error);
  process.exit(1);
}
