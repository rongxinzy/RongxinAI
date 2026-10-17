import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalDecisionSource,
  WorkbenchApprovalEffectStatus,
  WorkbenchApprovalMode,
  WorkbenchContractKind,
  WorkbenchRunTrigger,
  WorkbenchRunStatus,
  WorkbenchTaskStatus,
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
      approvalMode: WorkbenchApprovalMode.Ask,
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
      approvalMode: WorkbenchApprovalMode.AllowAll,
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

test('startup recovery marks a verifying run for review', async () => {
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
