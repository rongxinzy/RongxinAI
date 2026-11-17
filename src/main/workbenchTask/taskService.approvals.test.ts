import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalDecisionSource,
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
      decisionSource: WorkbenchApprovalDecisionSource.User,
    });
    service.recordToolApprovalDecision({
      approvalId: 'appr-deny',
      decision: WorkbenchApprovalDecision.Denied,
      decisionSource: WorkbenchApprovalDecisionSource.User,
      reason: 'not allowed',
    });
    const completed = service.settleObservedRun({
      sessionId: 'approvals',
      runId: run.id,
      finalAnswer: 'done',
    });

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
