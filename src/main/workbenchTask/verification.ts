import {
  WorkbenchContractKind,
  WorkbenchVerificationCheckStatus,
  WorkbenchVerificationOutcome,
  type WorkbenchTaskContract,
  type WorkbenchVerificationResult,
} from '../../shared/workbenchTask';

export interface WorkbenchVerificationContext {
  contract: WorkbenchTaskContract;
  finalAnswer: string;
  streamClosedCleanly: boolean;
}

export function verifyWorkbenchRun(
  context: WorkbenchVerificationContext,
): WorkbenchVerificationResult {
  const finalAnswerPresent = context.finalAnswer.trim().length > 0;
  const baselinePassed = finalAnswerPresent && context.streamClosedCleanly;
  const baselineChecks = [
    {
      name: 'final_response',
      status: finalAnswerPresent
        ? WorkbenchVerificationCheckStatus.Passed
        : WorkbenchVerificationCheckStatus.Failed,
      detail: finalAnswerPresent ? undefined : 'The final assistant response is empty.',
    },
    {
      name: 'stream_closed_cleanly',
      status: context.streamClosedCleanly
        ? WorkbenchVerificationCheckStatus.Passed
        : WorkbenchVerificationCheckStatus.Failed,
    },
  ];
  if (context.contract.kind === WorkbenchContractKind.Chat) {
    return {
      outcome: baselinePassed
        ? WorkbenchVerificationOutcome.Passed
        : WorkbenchVerificationOutcome.Failed,
      checks: baselineChecks,
      evidence: [],
      summary: baselinePassed
        ? 'The chat response contract passed.'
        : 'The chat response contract did not pass.',
    };
  }

  if (!baselinePassed) {
    return {
      outcome: WorkbenchVerificationOutcome.Failed,
      checks: baselineChecks,
      evidence: [],
      summary: 'The work result failed the baseline completeness checks.',
    };
  }

  if (!context.contract.requiresUserAcceptance) {
    return {
      outcome: WorkbenchVerificationOutcome.Passed,
      checks: [
        {
          name: 'deterministic_contract',
          status: WorkbenchVerificationCheckStatus.Passed,
          detail: 'The work result passed the baseline completeness checks.',
        },
        ...baselineChecks,
      ],
      evidence: [],
      summary: 'The work result passed the baseline completeness checks.',
    };
  }

  return {
    outcome: WorkbenchVerificationOutcome.AcceptanceRequired,
    checks: [
      {
        name: 'deterministic_contract',
        status: WorkbenchVerificationCheckStatus.Skipped,
        detail: 'No deterministic verifier is available for this work result.',
      },
      ...baselineChecks,
    ],
    evidence: [],
    summary: 'The result requires explicit user acceptance.',
  };
}
