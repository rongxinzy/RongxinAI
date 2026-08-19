import { expect, test } from 'vitest';

import { WorkbenchContractKind, WorkbenchVerificationOutcome } from '../../shared/workbenchTask';
import { verifyWorkbenchRun } from './verification';

test('chat completion requires a non-empty final response and clean stream close', () => {
  const passed = verifyWorkbenchRun({
    contract: {
      kind: WorkbenchContractKind.Chat,
      requiresUserAcceptance: false,
    },
    finalAnswer: 'Done',
    streamClosedCleanly: true,
  });
  expect(passed.outcome).toBe(WorkbenchVerificationOutcome.Passed);

  const failed = verifyWorkbenchRun({
    contract: {
      kind: WorkbenchContractKind.Chat,
      requiresUserAcceptance: false,
    },
    finalAnswer: '',
    streamClosedCleanly: true,
  });
  expect(failed.outcome).toBe(WorkbenchVerificationOutcome.Failed);
});

test('controlled workflow fails when any completion gate remains', () => {
  const result = verifyWorkbenchRun({
    contract: {
      kind: WorkbenchContractKind.Shortcut,
      requiresUserAcceptance: false,
    },
    finalAnswer: 'Generated report',
    streamClosedCleanly: true,
    workflowCompleted: true,
    workflowSnapshot: { completionFailures: ['Preview is missing'] },
  });
  expect(result.outcome).toBe(WorkbenchVerificationOutcome.Failed);
});

test('generic work falls back to explicit acceptance', () => {
  const result = verifyWorkbenchRun({
    contract: {
      kind: WorkbenchContractKind.GenericWork,
      requiresUserAcceptance: true,
    },
    finalAnswer: 'Implementation finished',
    streamClosedCleanly: true,
  });
  expect(result.outcome).toBe(WorkbenchVerificationOutcome.AcceptanceRequired);
});

test('generic workflow snapshots cannot bypass Workbench acceptance', () => {
  const result = verifyWorkbenchRun({
    contract: {
      kind: WorkbenchContractKind.GenericWork,
      requiresUserAcceptance: true,
    },
    finalAnswer: 'Implementation finished',
    streamClosedCleanly: true,
    workflowCompleted: true,
    workflowSnapshot: { accepted: true, status: 'ready_to_deliver' },
  });
  expect(result.outcome).toBe(WorkbenchVerificationOutcome.AcceptanceRequired);
});
test('generic work without user acceptance passes on baseline checks alone', () => {
  const result = verifyWorkbenchRun({
    contract: {
      kind: WorkbenchContractKind.GenericWork,
      requiresUserAcceptance: false,
    },
    finalAnswer: '2',
    streamClosedCleanly: true,
  });
  expect(result.outcome).toBe(WorkbenchVerificationOutcome.Passed);
  expect(result.checks.some(check => check.name === 'deterministic_contract')).toBe(true);

  // Baseline failures still block the run.
  const failed = verifyWorkbenchRun({
    contract: {
      kind: WorkbenchContractKind.GenericWork,
      requiresUserAcceptance: false,
    },
    finalAnswer: '',
    streamClosedCleanly: true,
  });
  expect(failed.outcome).toBe(WorkbenchVerificationOutcome.Failed);
});

test('a skipped production workflow passes without manual acceptance', () => {
  const result = verifyWorkbenchRun({
    contract: {
      kind: WorkbenchContractKind.GenericWork,
      requiresUserAcceptance: true,
    },
    finalAnswer: '2',
    streamClosedCleanly: true,
    workflowSnapshot: { skipped: true, phase: 'plan' },
  });
  expect(result.outcome).toBe(WorkbenchVerificationOutcome.Passed);
  expect(result.checks.some(check => check.name === 'workflow_skipped')).toBe(true);
});

test('generic work cannot use acceptance to override baseline failures', () => {
  const contract = {
    kind: WorkbenchContractKind.GenericWork,
    requiresUserAcceptance: true,
  };
  expect(
    verifyWorkbenchRun({
      contract,
      finalAnswer: '',
      streamClosedCleanly: true,
    }).outcome,
  ).toBe(WorkbenchVerificationOutcome.Failed);
  expect(
    verifyWorkbenchRun({
      contract,
      finalAnswer: 'Done',
      streamClosedCleanly: false,
    }).outcome,
  ).toBe(WorkbenchVerificationOutcome.Failed);
});
