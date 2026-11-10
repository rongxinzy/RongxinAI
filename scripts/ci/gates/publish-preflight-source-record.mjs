#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import {
  PREFLIGHT_SOURCE_RECORD_FILE,
  buildPreflightSourceRecord,
} from './release-candidate-attestation.ts';

const repository = process.env.GITHUB_REPOSITORY ?? '';
const sourceCommit = process.env.SOURCE_COMMIT ?? '';
const includePackaging = process.env.INCLUDE_PACKAGING;
const dispatchRef = process.env.GITHUB_REF ?? '';
const workflowHeadSha = process.env.GITHUB_SHA ?? '';
const workflowRunId = Number(process.env.GITHUB_RUN_ID);
const workflowRunAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);

if (!repository || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
  console.error('[PreflightSourceRecord] repository and SOURCE_COMMIT are required');
  process.exit(1);
}
if (includePackaging !== 'true' && includePackaging !== 'false') {
  console.error('[PreflightSourceRecord] INCLUDE_PACKAGING must be true or false');
  process.exit(1);
}
if (!Number.isInteger(workflowRunId) || !Number.isInteger(workflowRunAttempt)) {
  console.error('[PreflightSourceRecord] workflow run metadata is required');
  process.exit(1);
}

const record = buildPreflightSourceRecord({
  repository,
  workflowRunId,
  workflowRunAttempt,
  dispatchRef,
  workflowHeadSha,
  sourceCommit,
  includePackaging: includePackaging === 'true',
});
writeFileSync(PREFLIGHT_SOURCE_RECORD_FILE, `${JSON.stringify(record, null, 2)}\n`);
console.log(`[PreflightSourceRecord] wrote ${PREFLIGHT_SOURCE_RECORD_FILE} for ${sourceCommit}`);
