import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalDecisionSource,
  WorkbenchApprovalRiskLevel,
  WorkbenchContractKind,
  WorkbenchRunEventType,
  WorkbenchRunTrigger,
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

test('creates a new task for each ordinary user message and supersedes active runs', () => {
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
    expect(superseded?.task.status).toBe(WorkbenchExecutionStatus.Cancelled);
    expect(superseded?.task.activeRunId).toBeNull();
    expect(superseded?.runs[0].status).toBe(WorkbenchExecutionStatus.Cancelled);
    expect(superseded?.events).toContainEqual(
      expect.objectContaining({ type: WorkbenchRunEventType.RunCancelled }),
    );
  } finally {
    db.close();
  }
});

test('records settlement without creating a business acceptance result', () => {
  const { db, service } = createService();
  try {
    const first = service.beginRun({
      sessionId: 'session',
      goal: 'create a presentation',
      contract: {
        kind: WorkbenchContractKind.Shortcut,
      },
    });
    expect(first.task.contract).toEqual({ kind: WorkbenchContractKind.Shortcut });
    const completed = service.settleObservedRun({
      sessionId: 'session',
      runId: first.run.id,
      finalAnswer: 'done',
    });
    expect(completed?.task.status).toBe(WorkbenchExecutionStatus.Settled);
    expect(completed?.runs[0].status).toBe(WorkbenchExecutionStatus.Settled);
    expect(completed?.runs[0]).not.toHaveProperty('verificationResult');
  } finally {
    db.close();
  }
});

test('deleting a session expires pending observed approvals and removes all task records', () => {
  const { db, service } = createService();
  try {
    const { run } = service.beginRun({
      sessionId: 'session',
      goal: 'write',
      contract: chatContract,
    });
    service.recordToolCallObserved({
      runId: run.id,
      approvalId: 'approval-1',
      toolCallId: 'call',
      toolName: 'write',
      toolInput: { path: 'result.txt', content: 'ok' },
      riskLevel: WorkbenchApprovalRiskLevel.Reversible,
      idempotencyKey: 'idem-1',
      autoApproved: false,
    });
    service.deleteSession('session');
    expect(service.getCurrent('session')).toBeNull();
    expect(service.listForSession('session')).toEqual([]);
    expect(service.repository.listPendingApprovalsForSession('session')).toEqual([]);
  } finally {
    db.close();
  }
});

test('records passive approval resolution and tool results cleanly', () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'edit',
      contract: chatContract,
      trigger: WorkbenchRunTrigger.Message,
    });
    service.recordToolCallObserved({
      runId: run.id,
      approvalId: 'approval-1',
      toolCallId: 'call-1',
      toolName: 'write',
      toolInput: { path: 'a.txt' },
      riskLevel: WorkbenchApprovalRiskLevel.Reversible,
      idempotencyKey: 'idem-1',
      autoApproved: false,
    });
    service.recordToolApprovalDecision({
      approvalId: 'approval-1',
      decision: WorkbenchApprovalDecision.Approved,
      decisionSource: WorkbenchApprovalDecisionSource.User,
    });
    service.recordToolResult(run.id, 'call-1', { ok: true }, false);
    const detail = service.getDetail(task.id);
    expect(detail?.approvals[0].decision).toBe(WorkbenchApprovalDecision.Approved);
    expect(detail?.events.map(e => e.type)).toContain(WorkbenchRunEventType.ToolEffectFinished);
  } finally {
    db.close();
  }
});
