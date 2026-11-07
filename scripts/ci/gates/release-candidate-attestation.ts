import { PackagingJob } from './constants.ts';

export const RELEASE_CANDIDATE_ATTESTATION_SCHEMA_VERSION = 1 as const;
export const RELEASE_CANDIDATE_ATTESTATION_ARTIFACT_NAME = 'release-candidate-attestation';
export const RELEASE_CANDIDATE_ATTESTATION_FILE = 'release-candidate-attestation.json';
const RELEASE_PREFLIGHT_WORKFLOW_PATH = '.github/workflows/release-preflight.yml';

export type ReleaseCandidateAttestationV1 = {
  schemaVersion: typeof RELEASE_CANDIDATE_ATTESTATION_SCHEMA_VERSION;
  repository: string;
  workflowPath: typeof RELEASE_PREFLIGHT_WORKFLOW_PATH;
  workflowRunId: number;
  workflowRunAttempt: number;
  dispatchRef: string;
  workflowHeadSha: string;
  sourceCommit: string;
  includePackaging: true;
  preflightGate: 'success';
  packaging: Record<(typeof PackagingJob)[keyof typeof PackagingJob], 'success'>;
  issuedAt: string;
};

const shaPattern = /^[0-9a-f]{40}$/;

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function buildReleaseCandidateAttestation(input: {
  repository: string;
  workflowRunId: number;
  workflowRunAttempt: number;
  dispatchRef: string;
  workflowHeadSha: string;
  sourceCommit: string;
  packagingResults: Record<(typeof PackagingJob)[keyof typeof PackagingJob], string>;
  issuedAt?: string;
}): ReleaseCandidateAttestationV1 {
  for (const sha of [input.workflowHeadSha, input.sourceCommit]) {
    if (!shaPattern.test(sha)) throw new Error(`Invalid Git SHA: ${sha}`);
  }
  for (const name of Object.values(PackagingJob)) {
    if (input.packagingResults[name] !== 'success') {
      throw new Error(`Packaging job ${name} must be success before attestation`);
    }
  }
  return {
    schemaVersion: RELEASE_CANDIDATE_ATTESTATION_SCHEMA_VERSION,
    repository: input.repository,
    workflowPath: RELEASE_PREFLIGHT_WORKFLOW_PATH,
    workflowRunId: input.workflowRunId,
    workflowRunAttempt: input.workflowRunAttempt,
    dispatchRef: input.dispatchRef,
    workflowHeadSha: input.workflowHeadSha,
    sourceCommit: input.sourceCommit,
    includePackaging: true,
    preflightGate: 'success',
    packaging: {
      [PackagingJob.Linux]: 'success',
      [PackagingJob.Windows]: 'success',
    },
    issuedAt: input.issuedAt ?? new Date().toISOString(),
  };
}

export function parseReleaseCandidateAttestation(
  value: unknown,
  expected: { repository: string; sourceCommit: string },
): ReleaseCandidateAttestationV1 {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Attestation must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== RELEASE_CANDIDATE_ATTESTATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported attestation schemaVersion: ${String(record.schemaVersion)}`);
  }
  const repository = requireString(record.repository, 'repository');
  if (repository !== expected.repository) {
    throw new Error(
      `Attestation repository mismatch: expected ${expected.repository}, got ${repository}`,
    );
  }
  const workflowPath = requireString(record.workflowPath, 'workflowPath');
  if (workflowPath !== RELEASE_PREFLIGHT_WORKFLOW_PATH) {
    throw new Error(`Unexpected workflowPath: ${workflowPath}`);
  }
  const sourceCommit = requireString(record.sourceCommit, 'sourceCommit');
  if (sourceCommit !== expected.sourceCommit) {
    throw new Error(
      `Attestation sourceCommit mismatch: expected ${expected.sourceCommit}, got ${sourceCommit}`,
    );
  }
  if (record.includePackaging !== true) {
    throw new Error('Release gate requires includePackaging=true attestation');
  }
  if (record.preflightGate !== 'success') {
    throw new Error('Attestation preflightGate must be success');
  }
  const packaging = record.packaging;
  if (typeof packaging !== 'object' || packaging === null) {
    throw new Error('Attestation packaging must be an object');
  }
  for (const name of Object.values(PackagingJob)) {
    if ((packaging as Record<string, unknown>)[name] !== 'success') {
      throw new Error(`Attestation packaging.${name} must be success`);
    }
  }
  const workflowRunId = record.workflowRunId;
  if (typeof workflowRunId !== 'number' || !Number.isInteger(workflowRunId)) {
    throw new Error('workflowRunId must be an integer');
  }
  const workflowRunAttempt = record.workflowRunAttempt;
  if (typeof workflowRunAttempt !== 'number' || !Number.isInteger(workflowRunAttempt)) {
    throw new Error('workflowRunAttempt must be an integer');
  }
  for (const shaLabel of ['workflowHeadSha'] as const) {
    const sha = requireString(record[shaLabel], shaLabel);
    if (!shaPattern.test(sha)) throw new Error(`Invalid ${shaLabel}`);
  }
  requireString(record.dispatchRef, 'dispatchRef');
  requireString(record.issuedAt, 'issuedAt');

  return record as ReleaseCandidateAttestationV1;
}
