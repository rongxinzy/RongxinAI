import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalDecisionSource,
  WorkbenchApprovalEffectStatus,
  WorkbenchApprovalRiskLevel,
  WorkbenchContractKind,
  WorkbenchRunTrigger,
  WorkbenchRunStatus,
  WorkbenchTaskStatus,
} from '../../shared/workbenchTask';
import { initializeWorkbenchTaskSchema } from './schema';
import { WorkbenchTaskService } from './taskService';

const createService = () => {
  const db = new Database(':memory:');
  initializeWorkbenchTaskSchema(db);
  return { db, service: new WorkbenchTaskService(db) };
};

const chatContract = {
  kind: WorkbenchContractKind.Chat,
  requiresUserAcceptance: false,
};

test('reuses a nonterminal task and creates a new task after completion', () => {
  const { db, service } = createService();
  try {
    const first = service.beginRun({ sessionId: 'session', goal: 'first', contract: chatContract });
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
    expect(second.task.id).not.toBe(first.task.id);
    expect(second.run.attempt).toBe(1);
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
