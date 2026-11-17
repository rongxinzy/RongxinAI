import { expect, test, vi } from 'vitest';

import { MemoryKind, MemorySensitivity } from '../../shared/memory';
import {
  WorkbenchApprovalEffectStatus,
  WorkbenchApprovalDecision,
  WorkbenchApprovalDecisionSource,
  WorkbenchApprovalRiskLevel,
  WorkbenchArtifactKind,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
  WorkbenchExecutionStatus,
  WorkbenchRunTrigger,
  type WorkbenchApproval,
  type WorkbenchArtifact,
  type WorkbenchRun,
  type WorkbenchTask,
} from '../../shared/workbenchTask';
import {
  promoteSettledWorkbenchRun,
  type SettledWorkbenchRunMemorySource,
} from './taskMemoryPromotion';

function source(overrides: Partial<SettledWorkbenchRunMemorySource> = {}) {
  const task: WorkbenchTask = {
    id: 'task-1',
    sessionId: 'session-1',
    goal: 'Persist the verified architecture decision',
    status: WorkbenchExecutionStatus.Settled,
    contract: { kind: WorkbenchContractKind.GenericWork },
    activeRunId: null,
    createdAt: 1,
    updatedAt: 2,
    endedAt: 2,
  };
  const run: WorkbenchRun = {
    id: 'run-1',
    taskId: task.id,
    attempt: 1,
    status: WorkbenchExecutionStatus.Settled,
    trigger: WorkbenchRunTrigger.Message,
    startedAt: 1,
    endedAt: 2,
    context: null,
    failure: null,
    createdAt: 1,
    updatedAt: 2,
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
    workspaceRoot: 'C:/workspace/project',
    finalAnswer: 'The verified result establishes SQLite as the durable project store.',
    ...overrides,
  } satisfies SettledWorkbenchRunMemorySource;
}

test('creates an atomic review candidate with Task, Run, Artifact, and Approval provenance', async () => {
  const proposeProjectMemoryCandidate = vi.fn(() => 'candidate-1');
  const memory = {
    title: 'Project store',
    content: 'Use SQLite as the durable project store.',
    kind: MemoryKind.Decision,
    importance: 0.8,
    confidence: 0.95,
    sensitivity: MemorySensitivity.Normal,
    evidenceSourceIds: ['run:run-1:final-answer', 'artifact:artifact-1', 'approval:approval-1'],
  };
  const extractor = {
    extract: vi.fn(async () => ({
      memories: [memory],
      metadataFor: vi.fn(() => ({ extractorVersion: 1, sourceIds: memory.evidenceSourceIds })),
    })),
  };
  const result = await promoteSettledWorkbenchRun(
    { proposeProjectMemoryCandidate } as never,
    source(),
    vi.fn(),
    extractor as never,
  );

  expect(result).toEqual(['candidate-1']);
  expect(extractor.extract).toHaveBeenCalledWith(
    expect.objectContaining({
      maxItems: 5,
      sources: expect.arrayContaining([
        expect.objectContaining({ id: 'run:run-1:final-answer' }),
        expect.objectContaining({ id: 'artifact:artifact-1' }),
        expect.objectContaining({ id: 'approval:approval-1' }),
      ]),
    }),
  );
  expect(proposeProjectMemoryCandidate).toHaveBeenCalledWith(
    expect.objectContaining({
      taskId: 'task-1',
      runId: 'run-1',
      artifactId: 'artifact-1',
      approvalId: 'approval-1',
      topicKey: 'task/task-1/1',
      title: memory.title,
      content: memory.content,
      confidence: memory.confidence,
      metadata: expect.objectContaining({
        extraction: { extractorVersion: 1, sourceIds: memory.evidenceSourceIds },
      }),
    }),
  );
});

test('does not promote failed runs or ordinary chat completion', async () => {
  const proposeProjectMemoryCandidate = vi.fn();
  const failed = source({
    run: {
      ...source().run,
      status: WorkbenchExecutionStatus.Failed,
    },
  });
  const chat = source({
    task: {
      ...source().task,
      contract: { kind: WorkbenchContractKind.Chat },
    },
  });

  await expect(
    promoteSettledWorkbenchRun({ proposeProjectMemoryCandidate } as never, failed, vi.fn()),
  ).resolves.toEqual([]);
  await expect(
    promoteSettledWorkbenchRun({ proposeProjectMemoryCandidate } as never, chat, vi.fn()),
  ).resolves.toEqual([]);
  expect(proposeProjectMemoryCandidate).not.toHaveBeenCalled();
});
