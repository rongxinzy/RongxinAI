import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test, vi } from 'vitest';

import {
  WorkbenchApprovalMode,
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
  WorkbenchRunEventType,
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

test('registers a declared artifact before task completion', async () => {
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
    const artifact = await service.registerArtifact({
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

test('promotes a declared artifact when reviewed evidence is projected at completion', async () => {
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
      finalAnswer: 'Done',
      artifactCandidates: [
        {
          path: filePath,
          kind: 'report',
          role: 'report',
          source: WorkbenchArtifactCandidateSource.DomainWorkflow,
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
        source: WorkbenchArtifactCandidateSource.Declaration,
        declaredKind: 'report',
      },
    });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    db.close();
  }
});

test('user acceptance promotes pending workspace artifacts to verified', async () => {
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

    const pending = await service.completeRun({
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

test('lightweight inspected artifacts enter pending and are elevated by acceptance', async () => {
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
    const detail = await service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      finalAnswer: 'done',
      artifactCandidates: [
        {
          path: filePath,
          kind: 'report',
          role: 'report',
          source: WorkbenchArtifactCandidateSource.DomainWorkflow,
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
    await service.registerArtifact({
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
      approvalMode: WorkbenchApprovalMode.AllowAll,
    });
    service.recordToolResult(first.run.id, 'write-call', { path: filePath }, false);

    const completed = await service.completeRun({
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
    const nextCompleted = await service.completeRun({
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
