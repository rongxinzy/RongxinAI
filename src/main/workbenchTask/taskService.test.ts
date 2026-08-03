import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import {
  WorkbenchContractKind,
  WorkbenchRunStatus,
  WorkbenchRunTrigger,
  WorkbenchTaskStatus,
  WorkbenchVerificationOutcome,
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

test('reuses a non-terminal task and creates a new task after a terminal state', () => {
  const { db, service } = createService();
  try {
    const first = service.beginRun({ sessionId: 'session', goal: 'first', contract: chatContract });
    service.completeRun(first.run.id);
    const continued = service.beginRun({
      sessionId: 'session',
      goal: 'continue',
      contract: chatContract,
    });
    expect(continued.task.id).toBe(first.task.id);
    service.failRun('session', { message: 'terminal' });
    const next = service.beginRun({ sessionId: 'session', goal: 'next', contract: chatContract });
    expect(next.task.id).not.toBe(first.task.id);
  } finally {
    db.close();
  }
});

test('agent end requires verification instead of completing the task', () => {
  const { db, service } = createService();
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'answer',
      contract: chatContract,
    });
    const detail = service.completeRun(run.id);
    expect(detail.task.id).toBe(task.id);
    expect(detail.task.status).toBe(WorkbenchTaskStatus.NeedsReview);
    expect(detail.runs[0].status).toBe(WorkbenchRunStatus.NeedsReview);
    expect(detail.runs[0].verificationResult?.outcome).toBe(
      WorkbenchVerificationOutcome.AcceptanceRequired,
    );
  } finally {
    db.close();
  }
});

test('resume and retry create incrementing immutable run attempts', () => {
  const { db, service } = createService();
  try {
    const first = service.beginRun({ sessionId: 'session', goal: 'work', contract: chatContract });
    service.pauseRun('session', 'pause');
    const resumed = service.prepareRun(first.task.id, WorkbenchRunTrigger.Resume);
    service.failRun('session', { message: 'failed' });
    const retried = service.prepareRun(first.task.id, WorkbenchRunTrigger.Retry);
    expect([first.run.attempt, resumed.run.attempt, retried.run.attempt]).toEqual([1, 2, 3]);
    expect(service.getDetail(first.task.id)?.runs.map(run => run.status)).toEqual([
      WorkbenchRunStatus.Queued,
      WorkbenchRunStatus.Failed,
      WorkbenchRunStatus.Paused,
    ]);
  } finally {
    db.close();
  }
});

test('startup recovery marks interrupted runs for explicit review', () => {
  const { db, service } = createService();
  try {
    const { task } = service.beginRun({
      sessionId: 'session',
      goal: 'recover',
      contract: chatContract,
    });
    expect(service.recoverInterruptedState()).toBe(1);
    const detail = service.getDetail(task.id);
    expect(detail?.task.status).toBe(WorkbenchTaskStatus.NeedsReview);
    expect(detail?.runs[0].status).toBe(WorkbenchRunStatus.NeedsReview);
  } finally {
    db.close();
  }
});
