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

test('work does not require an obsolete domain completion signal', () => {
  const result = verifyWorkbenchRun({
    contract: {
      kind: WorkbenchContractKind.Shortcut,
      requiresUserAcceptance: false,
    },
    finalAnswer: 'Generated report',
    streamClosedCleanly: true,
  });
  expect(result.outcome).toBe(WorkbenchVerificationOutcome.Passed);
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

test('explicit Workbench acceptance is still required when requested', () => {
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
