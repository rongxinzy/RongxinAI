import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test, vi } from 'vitest';

import {
  WorkbenchApprovalMode,
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
  WorkbenchRunEventType,
  WorkbenchRunStatus,
  WorkbenchTaskStatus,
  WorkbenchVerificationOutcome,
} from '../../shared/workbenchTask';
import { initializeWorkbenchTaskSchema } from './schema';
import { WorkbenchTaskService } from './taskService';
import { collectWorkbenchArtifacts } from './artifactCollector';
import type { WorkbenchTaskServiceOptions } from './taskService';

vi.mock('./artifactWorkerPool', () => ({
  collectWorkbenchArtifactsAsync: async (input: Parameters<typeof collectWorkbenchArtifacts>[0]) =>
    collectWorkbenchArtifacts(input),
}));

const createService = (options: WorkbenchTaskServiceOptions = {}) => {
  const db = new Database(':memory:');
  initializeWorkbenchTaskSchema(db);
  return { db, service: new WorkbenchTaskService(db, options) };
};

const chatContract = {
  kind: WorkbenchContractKind.Chat,
  requiresUserAcceptance: false,
};

test('emits a verified run source only after deterministic verification passes', async () => {
  const onVerifiedRun = vi.fn();
  const { db, service } = createService({ onVerifiedRun });
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'record a verified outcome',
      contract: chatContract,
    });
    await service.completeRun({
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

test('rejects completion when deterministic domain verification fails', async () => {
  const onVerifiedRun = vi.fn();
  const { db, service } = createService({ onVerifiedRun });
  try {
    const contract = {
      kind: WorkbenchContractKind.Shortcut,
      requiresUserAcceptance: false,
    };
    const { run } = service.beginRun({
      sessionId: 'session',
      goal: 'build a document',
      contract,
    });

    const detail = await service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: process.cwd(),
      finalAnswer: 'done',
      workflowCompleted: false,
      workflowSnapshot: { completionFailures: ['Deliverable missing'] },
    });

    expect(detail.task.status).toBe(WorkbenchTaskStatus.NeedsReview);
    expect(detail.runs[0].verificationResult?.outcome).toBe(WorkbenchVerificationOutcome.Failed);
    expect(onVerifiedRun).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});

test('keeps acceptance-required work pending until explicit user acceptance', async () => {
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

    const pending = await service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: process.cwd(),
      finalAnswer: 'done',
    });

    expect(pending.task.status).toBe(WorkbenchTaskStatus.NeedsReview);
    expect(pending.runs[0].verificationResult?.outcome).toBe(
      WorkbenchVerificationOutcome.AcceptanceRequired,
    );

    const accepted = service.acceptTask(task.id);
    expect(accepted.task.status).toBe(WorkbenchTaskStatus.Completed);
  } finally {
    db.close();
  }
});

test('baseline pass without the production workflow requires acceptance when artifacts exist', async () => {
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
    await service.registerArtifact({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      candidate: {
        path: filePath,
        role: 'deliverable',
        source: WorkbenchArtifactCandidateSource.Declaration,
      },
    });

    const detail = await service.completeRun({
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

test('baseline pass without artifacts completes without acceptance', async () => {
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

    const detail = await service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: process.cwd(),
      finalAnswer: 'done',
    });

    expect(detail.task.status).toBe(WorkbenchTaskStatus.Completed);
    expect(detail.runs[0].verificationResult?.outcome).toBe(WorkbenchVerificationOutcome.Passed);
  } finally {
    db.close();
  }
});

test('user acceptance dispatches the verified-run memory promotion', async () => {
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
    await service.registerArtifact({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      candidate: {
        path: filePath,
        role: 'deliverable',
        source: WorkbenchArtifactCandidateSource.Declaration,
      },
    });
    await service.completeRun({
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
      approvalMode: WorkbenchApprovalMode.Ask,
    });
    const approval = service.getDetail(task.id)?.approvals[0];
    service.respondToApproval({ approvalId: approval!.id, approved: false });
    await authorization;

    const detail = await service.completeRun({
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
