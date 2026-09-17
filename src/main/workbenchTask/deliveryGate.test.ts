import { expect, test } from 'vitest';
import { CoworkArtifactRole } from '../../shared/cowork/artifacts';
import {
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactKind,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
  WorkbenchOutputMode,
  WorkbenchVerificationOutcome,
  isWorkbenchDeliverable,
  type WorkbenchArtifact,
  type WorkbenchOutputRequirement,
  type WorkbenchTaskContract,
} from '../../shared/workbenchTask';
import { applyWorkbenchDeliveryGate } from './deliveryGate';

const passed = {
  outcome: WorkbenchVerificationOutcome.Passed,
  checks: [],
  evidence: [],
  summary: 'done',
};
const contract = (requirements?: WorkbenchOutputRequirement[]): WorkbenchTaskContract => ({
  kind: WorkbenchContractKind.GenericWork,
  requiresUserAcceptance: false,
  outputRequirements: requirements,
});
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

test('ordinary response fragments cannot satisfy file or inline delivery, even if previously verified', () => {
  for (const mode of [WorkbenchOutputMode.File, WorkbenchOutputMode.Inline]) {
    const output = contract([{ mode, formats: ['csv'] }]);
    expect(isWorkbenchDeliverable(block(false, true), output)).toBe(false);
    expect(applyWorkbenchDeliveryGate(passed, [block(false, true)], output).outcome).toBe(
      WorkbenchVerificationOutcome.Failed,
    );
  }
});

test('explicit inline artifacts require inline permission and human acceptance', () => {
  const inline = contract([{ mode: WorkbenchOutputMode.Inline, formats: ['csv'] }]);
  expect(applyWorkbenchDeliveryGate(passed, [block(true)], inline).outcome).toBe(
    WorkbenchVerificationOutcome.AcceptanceRequired,
  );
  expect(isWorkbenchDeliverable(block(true), contract())).toBe(false);
  expect(
    isWorkbenchDeliverable(
      block(true),
      contract([{ mode: WorkbenchOutputMode.Text, formats: [] }]),
    ),
  ).toBe(false);
  expect(
    isWorkbenchDeliverable(
      block(true),
      contract([{ mode: WorkbenchOutputMode.Inline, formats: ['html'] }]),
    ),
  ).toBe(false);
});

test('CSV satisfies CSV or allowed table formats, but never an XLSX requirement', () => {
  const csv = file('table.csv');
  expect(
    applyWorkbenchDeliveryGate(
      passed,
      [csv],
      contract([{ mode: WorkbenchOutputMode.File, formats: ['csv', 'tsv'] }]),
    ).outcome,
  ).toBe(WorkbenchVerificationOutcome.AcceptanceRequired);
  expect(
    applyWorkbenchDeliveryGate(
      passed,
      [csv, block(true)],
      contract([{ mode: WorkbenchOutputMode.File, formats: ['xlsx'] }]),
    ).outcome,
  ).toBe(WorkbenchVerificationOutcome.Failed);
});

test('every output requirement must be met and file formats come from actual extensions', () => {
  const output = contract([
    { mode: WorkbenchOutputMode.File, formats: ['xlsx'] },
    { mode: WorkbenchOutputMode.File, formats: ['pdf'] },
  ]);
  const disguised = {
    ...file('table.csv'),
    metadata: { ...file('table.csv').metadata, declaredKind: 'xlsx' },
  };
  expect(applyWorkbenchDeliveryGate(passed, [disguised, file('report.pdf')], output).outcome).toBe(
    WorkbenchVerificationOutcome.Failed,
  );
  expect(
    applyWorkbenchDeliveryGate(passed, [file('table.XLSX'), file('report.pdf')], output).outcome,
  ).toBe(WorkbenchVerificationOutcome.AcceptanceRequired);
});

test('text tasks may use temporary files without a mandatory file delivery', () => {
  const output = contract([{ mode: WorkbenchOutputMode.Text, formats: [] }]);
  const script = file('build.py', CoworkArtifactRole.Intermediate);
  expect(applyWorkbenchDeliveryGate(passed, [script, block(false)], output)).toBe(passed);
});

test('uncommitted output requirements and failed file verification cannot be accepted', () => {
  expect(applyWorkbenchDeliveryGate(passed, [file('table.csv')], contract([])).outcome).toBe(
    WorkbenchVerificationOutcome.Failed,
  );
  const failed = {
    ...file('table.csv'),
    verificationStatus: WorkbenchArtifactVerificationStatus.Failed,
  };
  expect(
    applyWorkbenchDeliveryGate(
      passed,
      [failed],
      contract([{ mode: WorkbenchOutputMode.File, formats: ['csv'] }]),
    ).outcome,
  ).toBe(WorkbenchVerificationOutcome.Failed);
  const failure = { ...passed, outcome: WorkbenchVerificationOutcome.Failed };
  expect(applyWorkbenchDeliveryGate(failure, [], contract())).toBe(failure);
});
