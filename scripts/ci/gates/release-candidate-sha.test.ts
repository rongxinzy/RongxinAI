import { expect, test } from 'vitest';
import {
  buildPreflightSourceRecord,
  buildReleaseCandidateAttestation,
  parsePreflightSourceRecord,
  parseReleaseCandidateAttestation,
} from './release-candidate-attestation.ts';

const shaInput = {
  repository: 'rongxinzy/RongxinAI',
  workflowRunId: 50,
  workflowRunAttempt: 2,
  dispatchRef: 'refs/heads/main',
  workflowHeadSha: 'c'.repeat(40),
  sourceCommit: 'a'.repeat(40),
};
const shaSource = buildPreflightSourceRecord({ ...shaInput, includePackaging: true });
const shaAttestation = buildReleaseCandidateAttestation({
  ...shaInput,
  packagingResults: { 'linux-install': 'success', 'windows-install': 'success' },
});

for (const kind of ['source', 'attestation'] as const) {
  for (const field of ['sourceCommit', 'workflowHeadSha'] as const) {
    for (const invalid of ['not-a-sha', 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40)]) {
      test(`${kind} rejects malformed ${field}: ${invalid}`, () => {
        const record = { ...(kind === 'source' ? shaSource : shaAttestation), [field]: invalid };
        // Matching caller input must not make a malformed source SHA acceptable.
        const expected = {
          repository: shaInput.repository,
          sourceCommit: record.sourceCommit,
        };
        expect(() =>
          kind === 'source'
            ? parsePreflightSourceRecord(record, expected)
            : parseReleaseCandidateAttestation(record, expected),
        ).toThrow(new RegExp(`Invalid ${field}`));
      });
    }
  }
  test(`${kind} accepts valid SHA-1 source and workflow revisions`, () => {
    const expected = { repository: shaInput.repository, sourceCommit: shaInput.sourceCommit };
    const parsed =
      kind === 'source'
        ? parsePreflightSourceRecord(shaSource, expected)
        : parseReleaseCandidateAttestation(shaAttestation, expected);
    expect(parsed.sourceCommit).toBe(shaInput.sourceCommit);
    expect(parsed.workflowHeadSha).toBe(shaInput.workflowHeadSha);
  });
}
