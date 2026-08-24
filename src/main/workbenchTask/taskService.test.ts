import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test, vi } from 'vitest';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalDecisionSource,
  WorkbenchApprovalEffectStatus,
  WorkbenchApprovalRiskLevel,
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
  WorkbenchRunEventType,
  WorkbenchRunTrigger,
  WorkbenchRunStatus,
  WorkbenchTaskStatus,
  WorkbenchVerificationOutcome,
} from '../../shared/workbenchTask';
import {
  ProductionLoopAction,
  ProductionLoopPhase,
  ProductionLoopStatus,
  ProductionLoopToolName,
  ProductionPlanItemStatus,
} from '../../shared/productionLoop';
import { initializeWorkbenchTaskSchema } from './schema';
import { initializeProductionLoopSchema } from '../productionLoop/schema';
import { WorkbenchTaskService } from './taskService';
import type { WorkbenchTaskServiceOptions } from './taskService';

const createService = (options: WorkbenchTaskServiceOptions = {}) => {
  const db = new Database(':memory:');
  initializeWorkbenchTaskSchema(db);
  initializeProductionLoopSchema(db);
  return { db, service: new WorkbenchTaskService(db, options) };
};

const chatContract = {
  kind: WorkbenchContractKind.Chat,
  requiresUserAcceptance: false,
};

const prepareProductionDelivery = (
  service: WorkbenchTaskService,
  taskId: string,
  runId: string,
  workflowKind: WorkbenchContractKind,
) => {
  const task = service.repository.getTask(taskId);
  if (!task) throw new Error('Task missing in test setup.');
  service.productionLoop.beginRun({
    taskId,
    runId,
    workflowKind,
    goal: task.goal,
    prototypeRequired: false,
  });
  const planned = service.productionLoop.commitPlan(runId, {
    items: [{ title: 'Produce the result' }],
    constraints: ['Keep the result complete'],
    acceptanceCriteria: ['The result passes its completion contract'],
    expectedArtifacts: [{ kind: 'result', description: 'Final result', required: true }],
    expectedVerifiers: [{ name: 'completion_contract', deterministic: true }],
  });
  service.productionLoop.updatePlanItem(
    runId,
    planned.planItems[0].id,
    ProductionPlanItemStatus.Completed,
  );
  service.productionLoop.recordToolResult(runId, {
    toolCallId: 'completion-contract-check',
    toolName: 'bash',
    output: 'Completion contract passed.',
    isError: false,
  });
  const evidenceRef = service.productionLoop.getAvailableVerifierEvidence(runId)[0]?.evidenceRef;
  if (!evidenceRef) throw new Error('Verifier evidence missing in test setup.');
  service.productionLoop.startInspection(runId, {
    artifacts: [{ kind: 'result', reference: 'final-answer' }],
    verifiers: [{ name: 'completion_contract', evidenceRef }],
  });
  service.productionLoop.requestCritique(runId);
  service.productionLoop.recordCriticStart(runId, 'critic');
  service.productionLoop.recordCriticResult(
    runId,
    'critic',
    JSON.stringify({ verdict: 'pass', findings: [] }),
    false,
  );
  service.productionLoop.recordDeliveryRequest(runId, 'Critic approved delivery.');
};

test('completes the production loop only after deterministic verification passes', () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'answer',
      contract: chatContract,
    });
    prepareProductionDelivery(service, task.id, run.id, WorkbenchContractKind.Chat);

    const detail = service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: process.cwd(),
      finalAnswer: 'done',
    });

    expect(detail.task.status).toBe(WorkbenchTaskStatus.Completed);
    expect(service.productionLoop.repository.get(run.id)?.status).toBe(
      ProductionLoopStatus.Completed,
    );
  } finally {
    db.close();
  }
});

test('emits a verified run source only after deterministic verification passes', () => {
  const onVerifiedRun = vi.fn();
  const { db, service } = createService({ onVerifiedRun });
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'record a verified outcome',
      contract: chatContract,
    });
    prepareProductionDelivery(service, task.id, run.id, WorkbenchContractKind.Chat);
    service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: process.cwd(),
      finalAnswer: 'The deterministic verifier accepted this completed task result.',
    });

    expect(onVerifiedRun).toHaveBeenCalledOnce();
    expect(onVerifiedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({ id: task.id }),
        run: expect.objectContaining({ id: run.id, status: WorkbenchRunStatus.Succeeded }),
        verificationResult: expect.objectContaining({
          outcome: WorkbenchVerificationOutcome.Passed,
        }),
      }),
    );
  } finally {
    db.close();
  }
});

test('registers a declared artifact before production workflow completion', () => {
  const { db, service } = createService();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-ledger-'));
  const filePath = path.join(workspace, 'report.md');
  fs.writeFileSync(filePath, '# report');
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'create a small report',
      contract: chatContract,
    });
    const artifact = service.registerArtifact({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      candidate: {
        path: filePath,
        role: 'deliverable',
        source: WorkbenchArtifactCandidateSource.Declaration,
      },
    });

    expect(artifact).toMatchObject({
      taskId: task.id,
      runId: run.id,
      reference: 'report.md',
      verificationStatus: WorkbenchArtifactVerificationStatus.Pending,
    });
    expect(service.getDetail(task.id)?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: WorkbenchRunEventType.ArtifactRegistered }),
      ]),
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    db.close();
  }
});

test('promotes a declared artifact when reviewed evidence is projected at completion', () => {
  const { db, service } = createService();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-reviewed-artifact-'));
  const filePath = path.join(workspace, 'report.md');
  fs.writeFileSync(filePath, '# report');
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'create a reviewed report',
      contract: chatContract,
    });
    service.registerArtifact({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      candidate: {
        path: filePath,
        role: 'deliverable',
        source: WorkbenchArtifactCandidateSource.Declaration,
      },
    });

    const detail = service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      finalAnswer: 'Done',
      artifactCandidates: [
        {
          path: filePath,
          kind: 'report',
          role: 'report',
          source: WorkbenchArtifactCandidateSource.ProductionInspection,
          verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
        },
      ],
    });

    expect(detail.artifacts).toHaveLength(1);
    expect(detail.artifacts[0]).toMatchObject({
      taskId: task.id,
      provenance: WorkbenchArtifactProvenance.Controller,
      verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
      metadata: {
        source: WorkbenchArtifactCandidateSource.ProductionInspection,
        declaredKind: 'report',
      },
    });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    db.close();
  }
});

test('returns critic-approved work to revision when deterministic verification fails', () => {
  const onVerifiedRun = vi.fn();
  const { db, service } = createService({ onVerifiedRun });
  try {
    const contract = {
      kind: WorkbenchContractKind.Shortcut,
      requiresUserAcceptance: false,
    };
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'build a document',
      contract,
    });
    prepareProductionDelivery(service, task.id, run.id, WorkbenchContractKind.Shortcut);

    const detail = service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: process.cwd(),
      finalAnswer: 'done',
      workflowCompleted: false,
      workflowSnapshot: { completionFailures: ['Deliverable missing'] },
    });
    const loop = service.productionLoop.repository.get(run.id);

    expect(detail.task.status).toBe(WorkbenchTaskStatus.NeedsReview);
    expect(detail.runs[0].verificationResult?.outcome).toBe(WorkbenchVerificationOutcome.Failed);
    expect(loop).toMatchObject({
      phase: ProductionLoopPhase.Revise,
      status: ProductionLoopStatus.NeedsRevision,
      deliveryReason: null,
    });
    expect(onVerifiedRun).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});

test('keeps acceptance-required production work ready until explicit user acceptance', () => {
  const { db, service } = createService();
  try {
    const contract = {
      kind: WorkbenchContractKind.GenericWork,
      requiresUserAcceptance: true,
    };
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'complete generic work',
      contract,
    });
    prepareProductionDelivery(service, task.id, run.id, WorkbenchContractKind.GenericWork);

    const pending = service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: process.cwd(),
      finalAnswer: 'done',
    });

    expect(pending.task.status).toBe(WorkbenchTaskStatus.NeedsReview);
    expect(pending.runs[0].verificationResult?.outcome).toBe(
      WorkbenchVerificationOutcome.AcceptanceRequired,
    );
    expect(service.productionLoop.repository.get(run.id)?.status).toBe(
      ProductionLoopStatus.ReadyToDeliver,
    );

    const accepted = service.acceptTask(task.id);
    expect(accepted.task.status).toBe(WorkbenchTaskStatus.Completed);
    expect(service.productionLoop.repository.get(run.id)?.status).toBe(
      ProductionLoopStatus.Completed,
    );
  } finally {
    db.close();
  }
});

test('user acceptance promotes pending workspace artifacts to verified', () => {
  const { db, service } = createService();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-accept-artifact-'));
  const filePath = path.join(workspace, 'report.md');
  fs.writeFileSync(filePath, '# report');
  try {
    const contract = {
      kind: WorkbenchContractKind.GenericWork,
      requiresUserAcceptance: true,
    };
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'complete generic work',
      contract,
    });
    prepareProductionDelivery(service, task.id, run.id, WorkbenchContractKind.GenericWork);
    service.registerArtifact({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      candidate: {
        path: filePath,
        role: 'deliverable',
        source: WorkbenchArtifactCandidateSource.Declaration,
      },
    });

    const pending = service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      finalAnswer: 'done',
    });
    expect(pending.artifacts[0]?.verificationStatus).toBe(
      WorkbenchArtifactVerificationStatus.Pending,
    );

    const accepted = service.acceptTask(task.id);
    expect(accepted.artifacts[0]?.verificationStatus).toBe(
      WorkbenchArtifactVerificationStatus.Verified,
    );
    expect(accepted.events).toContainEqual(
      expect.objectContaining({
        type: WorkbenchRunEventType.VerificationFinished,
        payload: expect.objectContaining({ verifiedArtifacts: 1, acceptedByUser: true }),
      }),
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    db.close();
  }
});

test('baseline pass without the production workflow requires acceptance when artifacts exist', () => {
  const { db, service } = createService();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-baseline-artifact-'));
  const filePath = path.join(workspace, 'report.md');
  fs.writeFileSync(filePath, '# report');
  try {
    const contract = {
      kind: WorkbenchContractKind.GenericWork,
      requiresUserAcceptance: false,
    };
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'produce a quick report',
      contract,
    });
    service.registerArtifact({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      candidate: {
        path: filePath,
        role: 'deliverable',
        source: WorkbenchArtifactCandidateSource.Declaration,
      },
    });

    const detail = service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      finalAnswer: 'done',
    });

    // A passed baseline only attests a non-empty final response and a clean
    // stream — it says nothing about artifact content. Pending artifacts must
    // therefore go through explicit user acceptance instead of being
    // auto-promoted to verified.
    expect(detail.task.status).toBe(WorkbenchTaskStatus.NeedsReview);
    expect(detail.runs[0].verificationResult?.outcome).toBe(
      WorkbenchVerificationOutcome.AcceptanceRequired,
    );
    expect(detail.runs[0].verificationResult?.checks).toContainEqual(
      expect.objectContaining({ name: 'artifact_verification', status: 'skipped' }),
    );
    expect(detail.artifacts[0]?.verificationStatus).toBe(
      WorkbenchArtifactVerificationStatus.Pending,
    );
    expect(detail.events).toContainEqual(
      expect.objectContaining({
        type: WorkbenchRunEventType.VerificationFinished,
        payload: expect.objectContaining({ outcome: 'acceptance_required' }),
      }),
    );

    const accepted = service.acceptTask(task.id);
    expect(accepted.task.status).toBe(WorkbenchTaskStatus.Completed);
    expect(accepted.artifacts[0]?.verificationStatus).toBe(
      WorkbenchArtifactVerificationStatus.Verified,
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    db.close();
  }
});

test('baseline pass without artifacts completes without acceptance', () => {
  const { db, service } = createService();
  try {
    const contract = {
      kind: WorkbenchContractKind.GenericWork,
      requiresUserAcceptance: false,
    };
    const { run } = service.beginRun({
      sessionId: 'session',
      goal: 'answer a simple question',
      contract,
    });

    const detail = service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: process.cwd(),
      finalAnswer: 'done',
    });

    expect(detail.task.status).toBe(WorkbenchTaskStatus.Completed);
    expect(detail.runs[0].verificationResult?.outcome).toBe(
      WorkbenchVerificationOutcome.Passed,
    );
  } finally {
    db.close();
  }
});

test('user acceptance dispatches the verified-run memory promotion', () => {
  const onVerifiedRun = vi.fn();
  const { db, service } = createService({ onVerifiedRun });
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-accept-promotion-'));
  const filePath = path.join(workspace, 'report.md');
  fs.writeFileSync(filePath, '# report');
  try {
    const contract = {
      kind: WorkbenchContractKind.GenericWork,
      requiresUserAcceptance: true,
    };
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'complete generic work',
      contract,
    });
    service.updateRunContext(run.id, {
      model: 'test-model',
      provider: 'test-provider',
      reasoningProfile: 'default',
      workspaceRoot: workspace,
      skillIds: [],
    });
    prepareProductionDelivery(service, task.id, run.id, WorkbenchContractKind.GenericWork);
    service.registerArtifact({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      candidate: {
        path: filePath,
        role: 'deliverable',
        source: WorkbenchArtifactCandidateSource.Declaration,
      },
    });
    service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      finalAnswer: 'done',
    });
    expect(onVerifiedRun).not.toHaveBeenCalled();

    service.acceptTask(task.id);

    expect(onVerifiedRun).toHaveBeenCalledOnce();
    expect(onVerifiedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({ id: task.id }),
        run: expect.objectContaining({ id: run.id, status: WorkbenchRunStatus.Succeeded }),
        verificationResult: expect.objectContaining({
          outcome: WorkbenchVerificationOutcome.Passed,
        }),
        workspaceRoot: workspace,
        finalAnswer: 'done',
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
          }),
        ]),
      }),
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    db.close();
  }
});

test('lightweight inspected artifacts enter pending and are elevated by acceptance', () => {
  const { db, service } = createService();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-lightweight-artifact-'));
  const filePath = path.join(workspace, 'report.md');
  fs.writeFileSync(filePath, '# report');
  try {
    const contract = {
      kind: WorkbenchContractKind.GenericWork,
      requiresUserAcceptance: true,
    };
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'analyze gpu logs',
      contract,
    });
    // Lightweight production runs submit inspection artifacts that the
    // reviewer never passed: they must land as pending (not be dropped),
    // then be elevated by user acceptance.
    const detail = service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      finalAnswer: 'done',
      artifactCandidates: [
        {
          path: filePath,
          kind: 'report',
          role: 'report',
          source: WorkbenchArtifactCandidateSource.ProductionInspection,
          verificationStatus: WorkbenchArtifactVerificationStatus.Pending,
        },
      ],
    });

    expect(detail.artifacts).toHaveLength(1);
    expect(detail.artifacts[0]).toMatchObject({
      provenance: WorkbenchArtifactProvenance.Controller,
      verificationStatus: WorkbenchArtifactVerificationStatus.Pending,
    });

    const accepted = service.acceptTask(task.id);
    expect(accepted.artifacts[0]?.verificationStatus).toBe(
      WorkbenchArtifactVerificationStatus.Verified,
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    db.close();
  }
});

test('creates a new task for each ordinary user message', () => {
  const { db, service } = createService();
  try {
    const first = service.beginRun({ sessionId: 'session', goal: 'first', contract: chatContract });
    const second = service.beginRun({
      sessionId: 'session',
      goal: 'second',
      contract: chatContract,
    });

    expect(second.task.id).not.toBe(first.task.id);
    expect(second.run.attempt).toBe(1);
    const superseded = service.getDetail(first.task.id);
    expect(superseded?.task.status).toBe(WorkbenchTaskStatus.Cancelled);
    expect(superseded?.task.activeRunId).toBeNull();
    expect(superseded?.runs[0].status).toBe(WorkbenchRunStatus.Cancelled);
    expect(superseded?.events).toContainEqual(
      expect.objectContaining({ type: WorkbenchRunEventType.RunCancelled }),
    );
  } finally {
    db.close();
  }
});

test('supersedes a paused task instead of reusing its contract', async () => {
  const { db, service } = createService();
  try {
    const first = service.beginRun({
      sessionId: 'session',
      goal: 'create a presentation',
      contract: {
        kind: WorkbenchContractKind.Shortcut,
        requiresUserAcceptance: false,
      },
    });
    const authorization = service.authorizeToolCall({
      sessionId: 'session',
      runId: first.run.id,
      toolCallId: 'write-call',
      toolName: 'write',
      toolInput: { path: 'slides.md', content: 'draft' },
      autoApprove: false,
    });
    const approval = service.getDetail(first.task.id)?.approvals[0];
    service.respondToApproval({ approvalId: approval!.id, approved: false });
    await authorization;

    const second = service.beginRun({
      sessionId: 'session',
      goal: 'hello',
      contract: {
        kind: WorkbenchContractKind.GenericWork,
        requiresUserAcceptance: true,
      },
    });

    expect(second.task.id).not.toBe(first.task.id);
    expect(second.task.contract.kind).toBe(WorkbenchContractKind.GenericWork);
    expect(service.getDetail(first.task.id)?.task.status).toBe(WorkbenchTaskStatus.Cancelled);
    expect(service.getDetail(first.task.id)?.runs[0].status).toBe(WorkbenchRunStatus.Paused);
  } finally {
    db.close();
  }
});

test('expires pending approvals when a new message supersedes the task', async () => {
  const { db, service } = createService();
  try {
    const first = service.beginRun({
      sessionId: 'session',
      goal: 'write',
      contract: chatContract,
    });
    const authorization = service.authorizeToolCall({
      sessionId: 'session',
      runId: first.run.id,
      toolCallId: 'write-call',
      toolName: 'write',
      toolInput: { path: 'result.txt', content: 'draft' },
      autoApprove: false,
    });

    service.beginRun({ sessionId: 'session', goal: 'new request', contract: chatContract });

    await expect(authorization).resolves.toEqual({
      allow: false,
      reason: 'Superseded by a new user message.',
    });
    const superseded = service.getDetail(first.task.id);
    expect(superseded?.approvals[0].decision).toBe(WorkbenchApprovalDecision.Expired);
    expect(superseded?.runs[0].status).toBe(WorkbenchRunStatus.Cancelled);
    expect(superseded?.task.status).toBe(WorkbenchTaskStatus.Cancelled);
  } finally {
    db.close();
  }
});

test('explicit retry creates an incremented run under the same completed task', () => {
  const { db, service } = createService();
  try {
    const first = service.beginRun({ sessionId: 'session', goal: 'first', contract: chatContract });
    service.completeRun({
      sessionId: 'session',
      runId: first.run.id,
      workspaceRoot: process.cwd(),
      finalAnswer: 'done',
    });
    const prepared = service.prepareRun(first.task.id, WorkbenchRunTrigger.Retry);
    const retried = service.beginRun({
      sessionId: 'session',
      goal: 'first',
      contract: chatContract,
      preparedRunId: prepared.run.id,
    });
    expect(retried.task.id).toBe(first.task.id);
    expect(retried.run.attempt).toBe(2);
  } finally {
    db.close();
  }
});

test('successful side effects are not authorized twice', async () => {
  const { db, service } = createService();
  try {
    const { run } = service.beginRun({
      sessionId: 'session',
      goal: 'write',
      contract: {
        kind: WorkbenchContractKind.GenericWork,
        requiresUserAcceptance: true,
      },
    });
    const input = {
      sessionId: 'session',
      runId: run.id,
      toolCallId: 'call',
      toolName: 'write',
      toolInput: { path: 'result.txt', content: 'ok' },
      autoApprove: true,
    };
    expect((await service.authorizeToolCall(input)).allow).toBe(true);
    service.recordToolResult(run.id, 'call', { ok: true }, false);
    const duplicate = await service.authorizeToolCall(input);
    expect(duplicate.allow).toBe(false);
    expect(duplicate.reason).toContain('Reuse the persisted result: {"ok":true}');
  } finally {
    db.close();
  }
});

test('skip_workflow executes without creating a user approval', async () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'Explain the current state',
      contract: {
        kind: WorkbenchContractKind.GenericWork,
        requiresUserAcceptance: true,
      },
    });

    await expect(
      service.authorizeToolCall({
        sessionId: 'session',
        runId: run.id,
        toolCallId: 'skip-call',
        toolName: ProductionLoopToolName,
        toolInput: {
          action: ProductionLoopAction.SkipWorkflow,
          reason: 'Simple information request',
        },
        autoApprove: false,
      }),
    ).resolves.toEqual({ allow: true });
    expect(service.getDetail(task.id)?.approvals).toEqual([]);
  } finally {
    db.close();
  }
});

test('pending, denied, and failed side effects cannot be authorized again', async () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'write',
      contract: {
        kind: WorkbenchContractKind.GenericWork,
        requiresUserAcceptance: true,
      },
    });
    const pendingInput = {
      sessionId: 'session',
      runId: run.id,
      toolCallId: 'pending-call',
      toolName: 'write',
      toolInput: { path: 'pending.txt', content: 'ok' },
      autoApprove: false,
    };
    const pendingAuthorization = service.authorizeToolCall(pendingInput);
    expect((await service.authorizeToolCall(pendingInput)).allow).toBe(false);
    const pendingApproval = service.getDetail(task.id)?.approvals[0];
    expect(pendingApproval).toBeDefined();
    service.respondToApproval({ approvalId: pendingApproval!.id, approved: false });
    expect((await pendingAuthorization).allow).toBe(false);
    expect((await service.authorizeToolCall(pendingInput)).allow).toBe(false);

    const next = service.prepareRun(task.id, WorkbenchRunTrigger.Resume);
    service.beginRun({
      sessionId: 'session',
      goal: 'write',
      contract: task.contract,
      preparedRunId: next.run.id,
    });
    const failedInput = {
      ...pendingInput,
      runId: next.run.id,
      toolCallId: 'failed-call',
      autoApprove: true,
    };
    expect((await service.authorizeToolCall(failedInput)).allow).toBe(true);
    service.recordToolResult(next.run.id, failedInput.toolCallId, new Error('failed'), true);
    expect((await service.authorizeToolCall(failedInput)).allow).toBe(false);
  } finally {
    db.close();
  }
});

test('allow-all auto-approves irreversible effects', async () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'publish',
      contract: chatContract,
    });
    const authorization = service.authorizeToolCall({
      sessionId: 'session',
      runId: run.id,
      toolCallId: 'call',
      toolName: 'bash',
      toolInput: { command: 'git push origin main' },
      autoApprove: true,
    });
    const approval = service.getDetail(task.id)?.approvals[0];
    expect(approval?.riskLevel).toBe(WorkbenchApprovalRiskLevel.Irreversible);
    expect(approval?.decision).toBe(WorkbenchApprovalDecision.Approved);
    expect((await authorization).allow).toBe(true);
  } finally {
    db.close();
  }
});

test('rejects tool calls from another session or an inactive run', async () => {
  const { db, service } = createService();
  try {
    const first = service.beginRun({
      sessionId: 'session',
      goal: 'first',
      contract: chatContract,
    });
    service.completeRun({
      sessionId: 'session',
      runId: first.run.id,
      workspaceRoot: process.cwd(),
      finalAnswer: 'done',
    });
    const second = service.beginRun({
      sessionId: 'session',
      goal: 'second',
      contract: chatContract,
    });

    await expect(
      service.authorizeToolCall({
        sessionId: 'session',
        runId: first.run.id,
        toolCallId: 'stale-call',
        toolName: 'write',
        toolInput: { path: 'stale.txt' },
        autoApprove: true,
      }),
    ).resolves.toMatchObject({ allow: false, reason: expect.stringContaining('active run') });
    await expect(
      service.authorizeToolCall({
        sessionId: 'another-session',
        runId: second.run.id,
        toolCallId: 'foreign-call',
        toolName: 'write',
        toolInput: { path: 'foreign.txt' },
        autoApprove: true,
      }),
    ).resolves.toMatchObject({ allow: false, reason: expect.stringContaining('session') });
    expect(service.repository.listApprovalsForRun(first.run.id)).toHaveLength(0);
    expect(service.repository.listApprovalsForRun(second.run.id)).toHaveLength(0);
  } finally {
    db.close();
  }
});

test('agent end does not verify a run paused by a denied approval', async () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'write',
      contract: chatContract,
    });
    const authorization = service.authorizeToolCall({
      sessionId: 'session',
      runId: run.id,
      toolCallId: 'call',
      toolName: 'write',
      toolInput: { path: 'result.txt', content: 'ok' },
      autoApprove: false,
    });
    const approval = service.getDetail(task.id)?.approvals[0];
    service.respondToApproval({ approvalId: approval!.id, approved: false });
    await authorization;

    const detail = service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: process.cwd(),
      finalAnswer: 'done',
    });
    expect(detail.task.status).toBe(WorkbenchTaskStatus.Paused);
    expect(detail.runs[0].status).toBe(WorkbenchRunStatus.Paused);
    expect(detail.runs[0].verificationResult).toBeNull();
  } finally {
    db.close();
  }
});

test('reports only running workbench runs as eligible for continuation', () => {
  const { db, service } = createService();
  try {
    const { run } = service.beginRun({
      sessionId: 'session',
      goal: 'write',
      contract: chatContract,
    });

    expect(service.isRunRunning(run.id)).toBe(true);
    service.pauseRun('session', 'Paused for test.');
    expect(service.isRunRunning(run.id)).toBe(false);
    expect(service.isRunRunning('missing-run')).toBe(false);
  } finally {
    db.close();
  }
});

test('pausing a run expires and resolves its pending approval', async () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'write',
      contract: chatContract,
    });
    const authorization = service.authorizeToolCall({
      sessionId: 'session',
      runId: run.id,
      toolCallId: 'call',
      toolName: 'write',
      toolInput: { path: 'result.txt', content: 'ok' },
      autoApprove: false,
    });

    service.pauseRun('session', 'The user stopped this run.');

    await expect(authorization).resolves.toEqual({
      allow: false,
      reason: 'The user stopped this run.',
    });
    const detail = service.getDetail(task.id);
    expect(detail?.task.status).toBe(WorkbenchTaskStatus.Paused);
    expect(detail?.runs[0].status).toBe(WorkbenchRunStatus.Paused);
    expect(detail?.approvals[0].decision).toBe(WorkbenchApprovalDecision.Expired);
    expect(detail?.approvals[0].decisionSource).toBe(WorkbenchApprovalDecisionSource.Recovery);
  } finally {
    db.close();
  }
});

test('deleting a session resolves pending approvals before removing their records', async () => {
  const { db, service } = createService();
  try {
    const { run } = service.beginRun({
      sessionId: 'session',
      goal: 'write',
      contract: chatContract,
    });
    const authorization = service.authorizeToolCall({
      sessionId: 'session',
      runId: run.id,
      toolCallId: 'call',
      toolName: 'write',
      toolInput: { path: 'result.txt', content: 'ok' },
      autoApprove: false,
    });

    service.deleteSession('session');

    await expect(authorization).resolves.toEqual({
      allow: false,
      reason: 'The session was deleted.',
    });
    expect(service.getCurrent('session')).toBeNull();
  } finally {
    db.close();
  }
});

test('startup recovery preserves pending approval projection until resume', async () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'write',
      contract: chatContract,
    });
    const authorization = service.authorizeToolCall({
      sessionId: 'session',
      runId: run.id,
      toolCallId: 'call',
      toolName: 'write',
      toolInput: { path: 'result.txt', content: 'ok' },
      autoApprove: false,
    });

    expect(service.recoverInterruptedState()).toBe(1);
    expect((await authorization).allow).toBe(false);
    const detail = service.getDetail(task.id);
    expect(detail?.task.status).toBe(WorkbenchTaskStatus.Paused);
    expect(detail?.runs[0].status).toBe(WorkbenchRunStatus.Paused);
    expect(detail?.approvals[0].decision).toBe(WorkbenchApprovalDecision.Pending);
    expect(detail?.approvals[0].decisionSource).toBeNull();
    expect(() =>
      service.respondToApproval({ approvalId: detail!.approvals[0].id, approved: true }),
    ).toThrow('interrupted run');

    const resumed = service.prepareRun(task.id, WorkbenchRunTrigger.Resume);
    expect(resumed.task.id).toBe(task.id);
    expect(resumed.run.attempt).toBe(2);
    const resumedDetail = service.getDetail(task.id);
    expect(resumedDetail?.approvals[0].decision).toBe(WorkbenchApprovalDecision.Expired);
    expect(resumedDetail?.approvals[0].decisionSource).toBe(
      WorkbenchApprovalDecisionSource.Recovery,
    );
  } finally {
    db.close();
  }
});

test('tool results are persisted as bounded circular-safe JSON', async () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'write',
      contract: chatContract,
    });
    await service.authorizeToolCall({
      sessionId: 'session',
      runId: run.id,
      toolCallId: 'call',
      toolName: 'write',
      toolInput: { path: 'result.txt', content: 'ok' },
      autoApprove: true,
    });
    const result: Record<string, unknown> = { payload: 'x'.repeat(100_000) };
    result.self = result;
    service.recordToolResult(run.id, 'call', result, false);

    const persisted = service.getDetail(task.id)?.approvals[0].result;
    expect(persisted).not.toBeNull();
    expect(JSON.stringify(persisted).length).toBeLessThan(70_000);
    expect(JSON.stringify(persisted)).toContain('[Circular]');
  } finally {
    db.close();
  }
});

test('startup recovery marks executing effects and their runs for review', async () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'write',
      contract: {
        kind: WorkbenchContractKind.GenericWork,
        requiresUserAcceptance: true,
      },
    });
    await service.authorizeToolCall({
      sessionId: 'session',
      runId: run.id,
      toolCallId: 'call',
      toolName: 'write',
      toolInput: { path: 'result.txt', content: 'ok' },
      autoApprove: true,
    });
    expect(service.recoverInterruptedState()).toBe(1);
    const detail = service.getDetail(task.id);
    expect(detail?.task.status).toBe(WorkbenchTaskStatus.NeedsReview);
    expect(detail?.runs[0].status).toBe(WorkbenchRunStatus.NeedsReview);
    expect(detail?.approvals[0].effectStatus).toBe(WorkbenchApprovalEffectStatus.NeedsReview);
  } finally {
    db.close();
  }
});

test('startup recovery marks a verifying run for review', () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'verify',
      contract: chatContract,
    });
    service.repository.updateRunStatus(run.id, WorkbenchRunStatus.Verifying);

    expect(service.recoverInterruptedState()).toBe(1);
    const detail = service.getDetail(task.id);
    expect(detail?.task.status).toBe(WorkbenchTaskStatus.NeedsReview);
    expect(detail?.runs[0].status).toBe(WorkbenchRunStatus.NeedsReview);
  } finally {
    db.close();
  }
});

test('keeps declared artifact identity scoped to its run after tool-effect collection', async () => {
  const { db, service } = createService();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-run-artifact-'));
  const filePath = path.join(workspace, 'result.md');
  fs.writeFileSync(filePath, '# result');
  try {
    const first = service.beginRun({
      sessionId: 'session',
      goal: 'write a report',
      contract: chatContract,
    });
    service.registerArtifact({
      sessionId: 'session',
      runId: first.run.id,
      workspaceRoot: workspace,
      candidate: {
        path: filePath,
        role: 'deliverable',
        title: 'Final report',
        source: WorkbenchArtifactCandidateSource.Declaration,
      },
    });
    await service.authorizeToolCall({
      sessionId: 'session',
      runId: first.run.id,
      toolCallId: 'write-call',
      toolName: 'write',
      toolInput: { path: filePath, content: '# result' },
      autoApprove: true,
    });
    service.recordToolResult(first.run.id, 'write-call', { path: filePath }, false);

    const completed = service.completeRun({
      sessionId: 'session',
      runId: first.run.id,
      workspaceRoot: workspace,
      finalAnswer: 'done',
    });
    expect(completed.artifacts).toHaveLength(1);
    expect(completed.artifacts[0].metadata).toMatchObject({
      role: 'deliverable',
      title: 'Final report',
      source: WorkbenchArtifactCandidateSource.Declaration,
    });

    const second = service.beginRun({
      sessionId: 'session',
      goal: 'answer without a file',
      contract: chatContract,
    });
    const nextCompleted = service.completeRun({
      sessionId: 'session',
      runId: second.run.id,
      workspaceRoot: workspace,
      finalAnswer: 'done',
    });
    expect(nextCompleted.artifacts).toHaveLength(0);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    db.close();
  }
});
