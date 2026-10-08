import { expect, test } from 'vitest';
import { CoworkArtifactRole } from '../../shared/cowork/artifacts';
import {
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactKind,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  WorkbenchVerificationOutcome,
  isWorkbenchDeliverable,
  type WorkbenchArtifact,
  type WorkbenchVerificationResult,
} from '../../shared/workbenchTask';
import { applyWorkbenchDeliveryGate } from './deliveryGate';

const passed: WorkbenchVerificationResult = {
  outcome: WorkbenchVerificationOutcome.Passed,
  checks: [],
  evidence: [],
  summary: 'done',
};
const file = (
  reference: string,
  role: CoworkArtifactRole = CoworkArtifactRole.Deliverable,
): WorkbenchArtifact => ({
  id: reference,
  taskId: 'task',
  runId: 'run',
  reference,
  kind: WorkbenchArtifactKind.File,
  mimeType: 'text/csv',
  contentHash: 'hash',
  provenance: WorkbenchArtifactProvenance.Workspace,
  verificationStatus: WorkbenchArtifactVerificationStatus.Pending,
  metadata: { source: WorkbenchArtifactCandidateSource.Declaration, role },
  createdAt: 1,
  updatedAt: 1,
});
const block = (explicit: boolean, verified = false): WorkbenchArtifact => ({
  ...file('message:final:block:0'),
  kind: WorkbenchArtifactKind.MessageBlock,
  verificationStatus: verified
    ? WorkbenchArtifactVerificationStatus.Verified
    : WorkbenchArtifactVerificationStatus.Pending,
  metadata: {
    explicit,
    language: 'csv',
    role: explicit ? CoworkArtifactRole.Deliverable : CoworkArtifactRole.Intermediate,
  },
});

test('ordinary response fragments are never deliverables, even if previously verified', () => {
  expect(isWorkbenchDeliverable(block(false, true))).toBe(false);
  expect(applyWorkbenchDeliveryGate(passed, [block(false, true)])).toBe(passed);
});

test('explicit inline blocks declared as deliverables require human acceptance', () => {
  expect(isWorkbenchDeliverable(block(true))).toBe(true);
  expect(applyWorkbenchDeliveryGate(passed, [block(true)]).outcome).toBe(
    WorkbenchVerificationOutcome.AcceptanceRequired,
  );
});

test('a deliverable whose content verification failed fails the run', () => {
  const failed = {
    ...file('table.csv'),
    verificationStatus: WorkbenchArtifactVerificationStatus.Failed,
  };
  expect(applyWorkbenchDeliveryGate(passed, [failed]).outcome).toBe(
    WorkbenchVerificationOutcome.Failed,
  );
});

test('intermediate files and ordinary fragments pass the gate unchanged', () => {
  const script = file('build.py', CoworkArtifactRole.Intermediate);
  expect(applyWorkbenchDeliveryGate(passed, [script, block(false)])).toBe(passed);
});

test('a pending declared file requires acceptance before completion', () => {
  expect(applyWorkbenchDeliveryGate(passed, [file('table.csv')]).outcome).toBe(
    WorkbenchVerificationOutcome.AcceptanceRequired,
  );
});

test('already verified deliverables do not require acceptance again', () => {
  const verified = {
    ...file('table.csv'),
    verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
  };
  expect(applyWorkbenchDeliveryGate(passed, [verified])).toBe(passed);
});

test('a failed verification result is returned unchanged', () => {
  const failure: WorkbenchVerificationResult = {
    ...passed,
    outcome: WorkbenchVerificationOutcome.Failed,
  };
  expect(applyWorkbenchDeliveryGate(failure, [])).toBe(failure);
});
