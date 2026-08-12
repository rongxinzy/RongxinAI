import { expect, test, vi } from 'vitest';

import {
  WorkbenchApprovalEffectStatus,
  WorkbenchApprovalDecision,
  WorkbenchApprovalDecisionSource,
  WorkbenchApprovalRiskLevel,
  WorkbenchArtifactKind,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
  WorkbenchRunStatus,
  WorkbenchRunTrigger,
  WorkbenchTaskStatus,
  WorkbenchVerificationOutcome,
  type WorkbenchApproval,
  type WorkbenchArtifact,
  type WorkbenchRun,
  type WorkbenchTask,
  type WorkbenchVerificationResult,
} from '../../shared/workbenchTask';
import {
  promoteVerifiedWorkbenchRun,
  type VerifiedWorkbenchRunMemorySource,
} from './taskMemoryPromotion';

function source(overrides: Partial<VerifiedWorkbenchRunMemorySource> = {}) {
  const task: WorkbenchTask = {
    id: 'task-1',
    sessionId: 'session-1',
    goal: 'Persist the verified architecture decision',
    status: WorkbenchTaskStatus.Completed,
    contract: { kind: WorkbenchContractKind.GenericWork, requiresUserAcceptance: false },
    activeRunId: null,
    createdAt: 1,
    updatedAt: 2,
    completedAt: 2,
  };
  const run: WorkbenchRun = {
    id: 'run-1',
    taskId: task.id,
    attempt: 1,
    status: WorkbenchRunStatus.Succeeded,
    trigger: WorkbenchRunTrigger.Message,
    startedAt: 1,
    endedAt: 2,
    verificationResult: null,
    failure: null,
    createdAt: 1,
    updatedAt: 2,
  };
  const verificationResult: WorkbenchVerificationResult = {
    outcome: WorkbenchVerificationOutcome.Passed,
    checks: [],
    evidence: [],
    summary: 'All deterministic checks passed.',
  };
  const artifact = {
    id: 'artifact-1',
    taskId: task.id,
    runId: run.id,
    kind: WorkbenchArtifactKind.File,
    mimeType: 'text/plain',
    reference: 'result.txt',
    contentHash: 'hash',
    provenance: WorkbenchArtifactProvenance.Workspace,
    verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
    metadata: {},
    createdAt: 1,
    updatedAt: 2,
  } satisfies WorkbenchArtifact;
  const approval = {
    id: 'approval-1',
    taskId: task.id,
    runId: run.id,
    toolCallId: 'call-1',
    toolName: 'write',
    riskLevel: WorkbenchApprovalRiskLevel.Reversible,
    decision: WorkbenchApprovalDecision.Approved,
    decisionSource: WorkbenchApprovalDecisionSource.User,
    effectStatus: WorkbenchApprovalEffectStatus.Succeeded,
    idempotencyKey: 'key',
    request: {},
    result: {},
    createdAt: 1,
    updatedAt: 2,
    decidedAt: 2,
  } as WorkbenchApproval;
  return {
    task,
    run,
    artifacts: [artifact],
    approvals: [approval],
    verificationResult,
    workspaceRoot: 'C:/workspace/project',
    finalAnswer: 'The verified result establishes SQLite as the durable project store.',
    ...overrides,
  } satisfies VerifiedWorkbenchRunMemorySource;
}

test('creates a review candidate with Task, Run, Artifact, and Approval provenance', () => {
  const proposeProjectMemoryCandidate = vi.fn(() => 'candidate-1');
  const result = promoteVerifiedWorkbenchRun({ proposeProjectMemoryCandidate } as never, source());

  expect(result).toBe('candidate-1');
  expect(proposeProjectMemoryCandidate).toHaveBeenCalledWith(
    expect.objectContaining({
      taskId: 'task-1',
      runId: 'run-1',
      artifactId: 'artifact-1',
      approvalId: 'approval-1',
      topicKey: 'task/task-1',
      confidence: 1,
    }),
  );
});

test('does not promote failed verification or ordinary chat completion', () => {
  const proposeProjectMemoryCandidate = vi.fn();
  const failed = source({
    verificationResult: {
      ...source().verificationResult,
      outcome: WorkbenchVerificationOutcome.Failed,
    },
  });
  const chat = source({
    task: {
      ...source().task,
      contract: { kind: WorkbenchContractKind.Chat, requiresUserAcceptance: false },
    },
  });

  expect(
    promoteVerifiedWorkbenchRun({ proposeProjectMemoryCandidate } as never, failed),
  ).toBeNull();
  expect(promoteVerifiedWorkbenchRun({ proposeProjectMemoryCandidate } as never, chat)).toBeNull();
  expect(proposeProjectMemoryCandidate).not.toHaveBeenCalled();
});
