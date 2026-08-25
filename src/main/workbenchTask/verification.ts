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
  workflowCompleted?: boolean;
  workflowSnapshot?: Record<string, unknown> | null;
}

const completionFailures = (snapshot: Record<string, unknown> | null | undefined): string[] => {
  const raw = snapshot?.completionFailures;
  return Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === 'string')
    : [];
};

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

  if (
    context.contract.kind === WorkbenchContractKind.Research ||
    context.contract.kind === WorkbenchContractKind.Shortcut
  ) {
    const failures = completionFailures(context.workflowSnapshot);
    const passed = baselinePassed && context.workflowCompleted === true && failures.length === 0;
    return {
      outcome: passed ? WorkbenchVerificationOutcome.Passed : WorkbenchVerificationOutcome.Failed,
      checks: [
        ...baselineChecks,
        {
          name: 'workflow_completion_gate',
          status: passed
            ? WorkbenchVerificationCheckStatus.Passed
            : WorkbenchVerificationCheckStatus.Failed,
          detail: failures.join('; ') || (passed ? undefined : 'The workflow did not complete.'),
        },
      ],
      evidence: context.workflowSnapshot ? [context.workflowSnapshot] : [],
      summary: passed
        ? 'The deterministic workflow contract passed.'
        : 'The deterministic workflow contract requires review.',
    };
  }

  if (!baselinePassed) {
    return {
      outcome: WorkbenchVerificationOutcome.Failed,
      checks: baselineChecks,
      evidence: context.workflowSnapshot ? [context.workflowSnapshot] : [],
      summary: 'The work result failed the baseline completeness checks.',
    };
  }

  // Production controls are available to every Work turn, but a simple answer
  // may finish without activating them. In that dormant state the baseline is
  // the complete contract; activation changes this snapshot to true and makes
  // the production controller enforce its full lifecycle before agent_end.
  if (context.workflowSnapshot?.productionActive === false) {
    return {
      outcome: WorkbenchVerificationOutcome.Passed,
      checks: [
        {
          name: 'production_not_activated',
          status: WorkbenchVerificationCheckStatus.Passed,
        },
        ...baselineChecks,
      ],
      evidence: [context.workflowSnapshot],
      summary: 'The response passed baseline checks without activating production control.',
    };
  }

  // The production workflow was declared unnecessary (skip_workflow): the
  // baseline checks already passed, so there is nothing left to accept.
  if (context.workflowSnapshot?.skipped === true) {
    return {
      outcome: WorkbenchVerificationOutcome.Passed,
      checks: [
        {
          name: 'workflow_skipped',
          status: WorkbenchVerificationCheckStatus.Passed,
        },
      ],
      evidence: context.workflowSnapshot ? [context.workflowSnapshot] : [],
      summary: 'The production workflow was skipped; the baseline checks passed.',
    };
  }

  // Generic work without the production workflow (simple questions, trivial
  // requests) has no verifiable artifacts: the baseline checks are the only
  // gate and need no explicit user acceptance.
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
      evidence: context.workflowSnapshot ? [context.workflowSnapshot] : [],
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
    evidence: context.workflowSnapshot ? [context.workflowSnapshot] : [],
    summary: 'The result requires explicit user acceptance.',
  };
}
