import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalDecisionSource,
  WorkbenchApprovalMode,
  WorkbenchApprovalRiskLevel,
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
      approvalMode: WorkbenchApprovalMode.Ask,
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

test('accepts a synchronous approval response from an approvalRequested listener', async () => {
  const { db, service } = createService();
  try {
    const run = service.beginRun({
      sessionId: 'session',
      goal: 'write',
      contract: chatContract,
    });
    // In-process auto-approval answers inside the emit stack, before
    // authorizeToolCall returns — the pending entry must already exist.
    service.on('approvalRequested', ({ approval }) => {
      service.respondToApproval({ approvalId: approval.id, approved: true });
    });
    const authorization = await service.authorizeToolCall({
      sessionId: 'session',
      runId: run.run.id,
      toolCallId: 'write-call',
      toolName: 'write',
      toolInput: { path: 'result.txt', content: 'draft' },
      approvalMode: WorkbenchApprovalMode.Ask,
    });
    expect(authorization).toEqual({ allow: true });
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
      approvalMode: WorkbenchApprovalMode.AllowAll,
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
      approvalMode: WorkbenchApprovalMode.Ask,
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
      approvalMode: WorkbenchApprovalMode.AllowAll,
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
      approvalMode: WorkbenchApprovalMode.AllowAll,
    });
    const approval = service.getDetail(task.id)?.approvals[0];
    expect(approval?.riskLevel).toBe(WorkbenchApprovalRiskLevel.Irreversible);
    expect(approval?.decision).toBe(WorkbenchApprovalDecision.Approved);
    expect((await authorization).allow).toBe(true);
  } finally {
    db.close();
  }
});

test('auto mode approves reversible effects but still prompts for irreversible ones', async () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'write then delete',
      contract: chatContract,
    });
    const writeAuthorization = await service.authorizeToolCall({
      sessionId: 'session',
      runId: run.id,
      toolCallId: 'write-call',
      toolName: 'write',
      toolInput: { path: 'result.txt', content: 'ok' },
      approvalMode: WorkbenchApprovalMode.Auto,
    });
    const writeApproval = service
      .getDetail(task.id)
      ?.approvals.find(candidate => candidate.toolCallId === 'write-call');
    expect(writeAuthorization.allow).toBe(true);
    expect(writeApproval?.riskLevel).toBe(WorkbenchApprovalRiskLevel.Reversible);
    expect(writeApproval?.decision).toBe(WorkbenchApprovalDecision.Approved);

    const rmAuthorization = service.authorizeToolCall({
      sessionId: 'session',
      runId: run.id,
      toolCallId: 'rm-call',
      toolName: 'bash',
      toolInput: { command: 'rm result.txt' },
      approvalMode: WorkbenchApprovalMode.Auto,
    });
    const rmApproval = service
      .getDetail(task.id)
      ?.approvals.find(candidate => candidate.toolCallId === 'rm-call');
    expect(rmApproval?.riskLevel).toBe(WorkbenchApprovalRiskLevel.Irreversible);
    expect(rmApproval?.decision).toBe(WorkbenchApprovalDecision.Pending);
    service.respondToApproval({ approvalId: rmApproval!.id, approved: false });
    expect((await rmAuthorization).allow).toBe(false);
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
    await service.completeRun({
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
        approvalMode: WorkbenchApprovalMode.AllowAll,
      }),
    ).resolves.toMatchObject({ allow: false, reason: expect.stringContaining('active run') });
    await expect(
      service.authorizeToolCall({
        sessionId: 'another-session',
        runId: second.run.id,
        toolCallId: 'foreign-call',
        toolName: 'write',
        toolInput: { path: 'foreign.txt' },
        approvalMode: WorkbenchApprovalMode.AllowAll,
      }),
    ).resolves.toMatchObject({ allow: false, reason: expect.stringContaining('session') });
    expect(service.repository.listApprovalsForRun(first.run.id)).toHaveLength(0);
    expect(service.repository.listApprovalsForRun(second.run.id)).toHaveLength(0);
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
      approvalMode: WorkbenchApprovalMode.Ask,
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
      approvalMode: WorkbenchApprovalMode.AllowAll,
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
