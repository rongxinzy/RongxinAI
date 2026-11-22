import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalRiskLevel,
  WorkbenchContractKind,
  WorkbenchRunEventType,
  WorkbenchRunTrigger,
  WorkbenchExecutionStatus,
} from '../../shared/workbenchTask';
import { HarnessVersion } from '../../shared/harness';
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

test('publishes an already resolved run once with its context and profile committed', () => {
  const { db, service } = createService();
  try {
    const emitted = vi.fn(({ taskId }: { taskId: string }) => {
      expect(db.inTransaction).toBe(false);
      return service.getDetail(taskId);
    });
    service.on('changed', emitted);
    const context = {
      model: 'fixture/model',
      provider: 'fixture',
      reasoningProfile: 'default',
      workspaceRoot: '/fixture',
      skillIds: [],
    };
    const result = service.beginRun(
      { sessionId: 'session', goal: 'write', trigger: WorkbenchRunTrigger.Retry },
      {
        context,
        profile: {
          workflowKind: WorkbenchContractKind.GenericWork,
          harnessVersion: HarnessVersion,
        },
      },
    );

    expect(emitted).toHaveBeenCalledOnce();
    expect(emitted.mock.results[0].value?.runs[0].context).toEqual(context);
    const lifecycleEvents = emitted.mock.results[0].value?.events.slice(0, 2);
    expect(lifecycleEvents).toMatchObject([
      {
        type: WorkbenchRunEventType.RunCreated,
        createdAt: result.run.createdAt,
        payload: { trigger: WorkbenchRunTrigger.Retry, attempt: result.run.attempt },
      },
      {
        type: WorkbenchRunEventType.RunStarted,
        createdAt: result.run.startedAt,
        payload: { trigger: WorkbenchRunTrigger.Retry },
      },
    ]);
    expect(
      db
        .prepare(
          'SELECT payload_json FROM workbench_run_events WHERE run_id = ? AND type IN (?, ?)',
        )
        .pluck()
        .all(result.run.id, WorkbenchRunEventType.RunCreated, WorkbenchRunEventType.RunStarted),
    ).toEqual([]);
    expect(emitted.mock.results[0].value?.events).toContainEqual(
      expect.objectContaining({
        type: WorkbenchRunEventType.HarnessProfiled,
        runId: result.run.id,
      }),
    );
  } finally {
    db.close();
  }
});

test('preserves IDs, payloads and order of previously stored lifecycle events', () => {
  const { db, service } = createService();
  try {
    const { repository } = service;
    const task = repository.createTask('session', 'legacy work', chatContract);
    const run = repository.createRun(task.id, WorkbenchRunTrigger.Retry);
    const historical = { trigger: WorkbenchRunTrigger.Message, attempt: 3 };
    const created = repository.appendRunEvent(run.id, WorkbenchRunEventType.RunCreated, historical);
    repository.updateRunStatus(run.id, WorkbenchExecutionStatus.Running);
    const started = repository.appendRunEvent(run.id, WorkbenchRunEventType.RunStarted);
    repository.updateRunStatus(run.id, WorkbenchExecutionStatus.Failed, {
      failure: { reason: 'Run failure' },
    });
    const terminal = repository.appendRunEvent(run.id, WorkbenchRunEventType.RunFailed, {
      reason: 'Original audit reason',
    });
    db.prepare('UPDATE workbench_runs SET terminal_after_sequence = NULL WHERE id = ?').run(run.id);
    const late = repository.appendRunEvent(run.id, WorkbenchRunEventType.HarnessActivation);
    expect(service.getDetail(task.id)?.events).toEqual([
      created,
      { ...started, payload: { trigger: WorkbenchRunTrigger.Retry } },
      terminal,
      late,
    ]);
  } finally {
    db.close();
  }
});

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

test('a run-scoped startup failure cannot fail a newer attempt', () => {
  const { db, service } = createService();
  try {
    const first = service.beginRun({ sessionId: 'session', goal: 'first' });
    const replacement = service.beginRun({ sessionId: 'session', goal: 'replacement' });
    service.failRun('session', { message: 'late launch failure' }, first.run.id);
    expect(service.repository.getRun(first.run.id)?.status).toBe(
      WorkbenchExecutionStatus.Cancelled,
    );
    expect(service.repository.getRun(replacement.run.id)?.status).toBe(
      WorkbenchExecutionStatus.Running,
    );
  } finally {
    db.close();
  }
});

test.each([WorkbenchExecutionStatus.Failed, WorkbenchExecutionStatus.Cancelled])(
  'recording a %s run only expires approvals belonging to that run, even if another was reserved later',
  status => {
    const { db, service } = createService();
    try {
      const sessionId = 'session';
      const earlier = service.beginRun({ sessionId, goal: 'earlier' });
      const reserved = service.reserveRun({ sessionId, goal: 'reserved' });
      for (const runId of [earlier.run.id, reserved.runId]) {
        service.recordToolCallObserved({
          runId,
          approvalId: runId + '-approval',
          toolCallId: 'write',
          toolName: 'write',
          toolInput: { path: 'draft.txt' },
          riskLevel: WorkbenchApprovalRiskLevel.Reversible,
          idempotencyKey: runId,
          autoApproved: false,
        });
      }

      const failed = status === WorkbenchExecutionStatus.Failed;
      const failure = failed ? { message: 'Earlier run failed' } : { reason: 'Run cancelled.' };
      const eventType = failed
        ? WorkbenchRunEventType.RunFailed
        : WorkbenchRunEventType.RunCancelled;
      if (failed) {
        service.failRun(sessionId, failure, earlier.run.id);
      } else {
        service.cancelRun(sessionId, earlier.run.id);
      }

      expect(service.repository.getRun(earlier.run.id)).toMatchObject({ status, failure });
      expect(
        db
          .prepare('SELECT payload_json FROM workbench_run_events WHERE run_id = ? AND type = ?')
          .get(earlier.run.id, eventType),
      ).toBeUndefined();
      const readEvent = () =>
        service.getDetail(earlier.task.id)?.events.find(event => event.type === eventType);
      expect(readEvent()).toMatchObject({
        id: `${earlier.run.id}:${eventType}`,
        createdAt: service.repository.getRun(earlier.run.id)?.endedAt,
        payload: failure,
      });
      expect(service.repository.listApprovalsForRun(earlier.run.id)[0].decision).toBe(
        WorkbenchApprovalDecision.Expired,
      );
      expect(service.repository.getRun(reserved.runId)?.status).toBe(
        WorkbenchExecutionStatus.Queued,
      );
      expect(service.repository.listPendingApprovalsForRun(reserved.runId)).toHaveLength(1);
    } finally {
      db.close();
    }
  },
);

test('records settlement without creating a business acceptance result', () => {
  const onSettledRun = vi.fn();
  const { db, service } = createService({ onSettledRun });
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    // Existing databases may still have the old answer column.
    db.exec(`ALTER TABLE workbench_runs ADD COLUMN final_answer_json TEXT;
      CREATE TRIGGER reject_duplicate_task_state BEFORE UPDATE OF status, active_run_id, completed_at
      ON workbench_tasks BEGIN SELECT RAISE(ABORT, 'run owns the execution state'); END;`);
    const first = service.beginRun({
      sessionId: 'session',
      goal: 'create a presentation',
      contract: {
        kind: WorkbenchContractKind.Shortcut,
      },
    });
    expect(first.task.contract).toEqual({ kind: WorkbenchContractKind.Shortcut });
    expect(first.task.status).toBe(WorkbenchExecutionStatus.Running);
    expect(first.task.activeRunId).toBe(first.run.id);
    const before = service.repository.appendRunEvent(
      first.run.id,
      WorkbenchRunEventType.HarnessActivation,
    );
    const traceRead = vi.spyOn(service.repository, 'getDetail');
    service.settleObservedRun({
      sessionId: 'session',
      runId: first.run.id,
      finalAnswer: 'done',
    });
    expect(traceRead).not.toHaveBeenCalled();
    const after = service.repository.appendRunEvent(
      first.run.id,
      WorkbenchRunEventType.HarnessActivation,
    );
    const completed = service.getDetail(first.task.id);
    expect(completed?.task.status).toBe(WorkbenchExecutionStatus.Settled);
    expect(completed?.task.activeRunId).toBeNull();
    expect(completed?.task.endedAt).toBe(completed?.runs[0].endedAt);
    expect(completed?.runs[0].status).toBe(WorkbenchExecutionStatus.Settled);
    expect(completed?.runs[0]).not.toHaveProperty('verificationResult');
    expect(completed?.events.slice(-3)).toEqual([
      { ...before, sequence: 3 },
      expect.objectContaining({
        id: `${first.run.id}:${WorkbenchRunEventType.RunSettled}`,
        type: WorkbenchRunEventType.RunSettled,
        sequence: 4,
        createdAt: 1000,
        payload: {},
      }),
      { ...after, sequence: 5 },
    ]);
    expect(
      db
        .prepare('SELECT type FROM workbench_run_events WHERE run_id = ? ORDER BY sequence')
        .pluck()
        .all(first.run.id),
    ).toEqual([WorkbenchRunEventType.HarnessActivation, WorkbenchRunEventType.HarnessActivation]);
    expect(onSettledRun).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        finalAnswer: 'done',
        run: expect.objectContaining({ id: first.run.id }),
      }),
    );
    expect(
      db.prepare('SELECT final_answer_json FROM workbench_runs WHERE id = ?').get(first.run.id),
    ).toEqual({ final_answer_json: null });
  } finally {
    clock.mockRestore();
    db.close();
  }
});

test.each([undefined, 'lane'])(
  'settlement supplies the run and artifact readiness for scope %s without waiting',
  artifactScopeId => {
    const onSettledRun = vi.fn();
    const { db, service } = createService({ onSettledRun });
    const capture = Promise.withResolvers<void>();
    const memoryCompletion = vi.fn(async () => '');
    try {
      const { task, run } = service.beginRun({ sessionId: 'session', goal: 'write' });
      service.settleObservedRun({
        sessionId: 'session',
        runId: run.id,
        artifactScopeId,
        artifactsReady: capture.promise,
        memoryCompletion,
      });
      const { run: next } = service.beginRun({ sessionId: 'session', goal: 'next' });

      expect(service.repository.getRun(run.id)?.status).toBe(WorkbenchExecutionStatus.Settled);
      expect(service.repository.getRun(next.id)?.status).toBe(WorkbenchExecutionStatus.Running);
      expect(onSettledRun).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          task: expect.objectContaining({ id: task.id }),
          run: expect.objectContaining({ id: run.id }),
          artifactScopeId: artifactScopeId ?? 'session',
          artifactsReady: capture.promise,
          memoryCompletion,
        }),
      );
    } finally {
      capture.resolve();
      db.close();
    }
  },
);

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
    service.repository.deleteSessionDomainData(['session']);
    expect(service.getCurrent('session')).toBeNull();
    expect(service.listForSession('session')).toEqual([]);
    expect(service.repository.listPendingApprovalsForRun(run.id)).toEqual([]);
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
    });
    service.recordToolResult(run.id, 'call-1', { ok: true }, false);
    const detail = service.getDetail(task.id);
    expect(detail?.approvals[0].decision).toBe(WorkbenchApprovalDecision.Approved);
    expect(detail?.events.map(e => e.type)).toContain(WorkbenchRunEventType.ToolEffectFinished);
  } finally {
    db.close();
  }
});
