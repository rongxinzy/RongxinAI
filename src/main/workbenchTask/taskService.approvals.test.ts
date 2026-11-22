import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalDecisionSource,
  WorkbenchApprovalEffectStatus,
  WorkbenchApprovalRiskLevel,
  WorkbenchContractKind,
  WorkbenchRunEventType,
  WorkbenchExecutionStatus,
} from '../../shared/workbenchTask';
import { initializeWorkbenchTaskSchema } from './schema';
import { WorkbenchTaskService, type WorkbenchTaskServiceOptions } from './taskService';

const createService = (options: WorkbenchTaskServiceOptions = {}) => {
  const db = new Database(':memory:');
  initializeWorkbenchTaskSchema(db);
  return { db, service: new WorkbenchTaskService(db, options) };
};

const chatContract = {
  kind: WorkbenchContractKind.Chat,
};

test('passive observer records repeated identical tool calls without idempotency collisions', () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({
      sessionId: 'repeated',
      goal: 'work',
      contract: chatContract,
    });
    service.recordToolCallObserved({
      runId: run.id,
      approvalId: 'appr-1',
      toolCallId: 'call-1',
      toolName: 'bash',
      toolInput: { command: 'echo hi' },
      riskLevel: WorkbenchApprovalRiskLevel.Unknown,
      idempotencyKey: 'shared-idem',
      autoApproved: true,
    });
    service.recordToolCallObserved({
      runId: run.id,
      approvalId: 'appr-2',
      toolCallId: 'call-2',
      toolName: 'bash',
      toolInput: { command: 'echo hi' },
      riskLevel: WorkbenchApprovalRiskLevel.Unknown,
      idempotencyKey: 'shared-idem',
      autoApproved: true,
    });
    const detail = service.getDetail(task.id);
    expect(detail?.approvals).toHaveLength(2);
    expect(detail?.approvals.every(a => a.decision === WorkbenchApprovalDecision.Approved)).toBe(
      true,
    );
  } finally {
    db.close();
  }
});

test('passive approval observation records user approval, denial, and completion expiry', () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({
      sessionId: 'approvals',
      goal: 'work',
      contract: chatContract,
    });
    service.recordToolCallObserved({
      runId: run.id,
      approvalId: 'appr-approve',
      toolCallId: 'call-1',
      toolName: 'write',
      toolInput: { path: 'a.txt' },
      riskLevel: WorkbenchApprovalRiskLevel.Reversible,
      idempotencyKey: 'k1',
      autoApproved: false,
    });
    service.recordToolCallObserved({
      runId: run.id,
      approvalId: 'appr-deny',
      toolCallId: 'call-2',
      toolName: 'bash',
      toolInput: { command: 'rm -rf tmp' },
      riskLevel: WorkbenchApprovalRiskLevel.Irreversible,
      idempotencyKey: 'k2',
      autoApproved: false,
    });
    service.recordToolCallObserved({
      runId: run.id,
      approvalId: 'appr-stale',
      toolCallId: 'call-3',
      toolName: 'write',
      toolInput: { path: 'c.txt' },
      riskLevel: WorkbenchApprovalRiskLevel.Reversible,
      idempotencyKey: 'k3',
      autoApproved: false,
    });

    service.recordToolApprovalDecision({
      approvalId: 'appr-approve',
      decision: WorkbenchApprovalDecision.Approved,
    });
    service.recordToolApprovalDecision({
      approvalId: 'appr-deny',
      decision: WorkbenchApprovalDecision.Denied,
      reason: 'not allowed',
    });
    service.settleObservedRun({
      sessionId: 'approvals',
      runId: run.id,
      finalAnswer: 'done',
    });
    const completed = service.getDetail(task.id);

    const byId = new Map(completed!.approvals.map(a => [a.id, a]));
    expect(byId.get('appr-approve')?.decision).toBe(WorkbenchApprovalDecision.Approved);
    expect(byId.get('appr-deny')?.decision).toBe(WorkbenchApprovalDecision.Denied);
    expect(byId.get('appr-stale')?.decision).toBe(WorkbenchApprovalDecision.Expired);
    expect(completed!.runs[0].status).toBe(WorkbenchExecutionStatus.Settled);
    expect(completed!.events.map(e => e.type)).toContain(WorkbenchRunEventType.RunSettled);
  } finally {
    db.close();
  }
});

test('run cancellation and permission cleanup record one terminal decision per approval', () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({ sessionId: 'stopped', goal: 'work' });
    const approvalId = 'pending-stop';
    service.recordToolCallObserved({
      runId: run.id,
      approvalId,
      toolCallId: 'call',
      toolName: 'bash',
      toolInput: { command: 'printf test' },
      riskLevel: WorkbenchApprovalRiskLevel.Unknown,
      idempotencyKey: approvalId,
      autoApproved: false,
    });

    service.cancelRun(task.sessionId, run.id, 'The user stopped this run.');
    const changed = vi.fn();
    service.on('changed', changed);
    service.recordToolApprovalDecision({
      approvalId,
      decision: WorkbenchApprovalDecision.Expired,
      reason: 'Permission wait was cleared.',
    });
    service.recordToolApprovalDecision({
      approvalId,
      decision: WorkbenchApprovalDecision.Approved,
    });

    const detail = service.getDetail(task.id);
    expect(detail?.approvals[0]).toMatchObject({
      decision: WorkbenchApprovalDecision.Expired,
      decisionSource: WorkbenchApprovalDecisionSource.Recovery,
      result: { reason: 'The user stopped this run.' },
    });
    expect(
      detail?.events.filter(event => event.type === WorkbenchRunEventType.ApprovalResolved),
    ).toHaveLength(1);
    expect(changed).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});

test('closes running effects on stop and ignores denial output and repeated results', () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({ sessionId: 'effects', goal: 'work' });
    for (const call of ['completed', 'running', 'denied']) {
      service.recordToolCallObserved({
        runId: run.id,
        approvalId: call,
        toolCallId: call,
        toolName: 'write',
        toolInput: { path: 'a.txt' },
        riskLevel: WorkbenchApprovalRiskLevel.Reversible,
        idempotencyKey: call,
        autoApproved: call !== 'denied',
      });
    }
    service.recordToolApprovalDecision({
      approvalId: 'denied',
      decision: WorkbenchApprovalDecision.Denied,
      reason: 'Rejected by user',
    });
    service.recordToolResult(run.id, 'denied', { error: 'Tool blocked' }, true);
    service.recordToolResult(run.id, 'completed', { written: true }, false);
    service.recordToolResult(run.id, 'completed', { error: 'Replay' }, true);
    service.cancelRun(task.sessionId, run.id);
    service.recordToolResult(run.id, 'running', { written: true }, false);

    const detail = service.getDetail(task.id);
    expect(detail?.approvals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'denied',
          effectStatus: WorkbenchApprovalEffectStatus.NotStarted,
          result: { reason: 'Rejected by user' },
        }),
        expect.objectContaining({
          id: 'completed',
          effectStatus: WorkbenchApprovalEffectStatus.Succeeded,
          result: { written: true },
        }),
        expect.objectContaining({
          id: 'running',
          effectStatus: WorkbenchApprovalEffectStatus.NeedsReview,
          result: null,
        }),
      ]),
    );
    expect(
      detail?.events.filter(event => event.type === WorkbenchRunEventType.ToolEffectFinished),
    ).toHaveLength(1);
  } finally {
    db.close();
  }
});
