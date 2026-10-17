import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import {
  WorkbenchApprovalMode,
  WorkbenchContractKind,
  WorkbenchRunEventType,
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

test('creates a new task for each ordinary user message', async () => {
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
    expect(superseded?.task.status).toBe(WorkbenchTaskStatus.Cancelled);
    expect(superseded?.task.activeRunId).toBeNull();
    expect(superseded?.runs[0].status).toBe(WorkbenchRunStatus.Cancelled);
    expect(superseded?.events).toContainEqual(
      expect.objectContaining({ type: WorkbenchRunEventType.RunCancelled }),
    );
  } finally {
    db.close();
  }
});

test('supersedes a paused task instead of reusing its contract', async () => {
  const { db, service } = createService();
  try {
    const first = service.beginRun({
      sessionId: 'session',
      goal: 'create a presentation',
      contract: {
        kind: WorkbenchContractKind.Shortcut,
        requiresUserAcceptance: false,
      },
    });
    const authorization = service.authorizeToolCall({
      sessionId: 'session',
      runId: first.run.id,
      toolCallId: 'write-call',
      toolName: 'write',
      toolInput: { path: 'slides.md', content: 'draft' },
      approvalMode: WorkbenchApprovalMode.Ask,
    });
    const approval = service.getDetail(first.task.id)?.approvals[0];
    service.respondToApproval({ approvalId: approval!.id, approved: false });
    await authorization;

    const second = service.beginRun({
      sessionId: 'session',
      goal: 'hello',
      contract: {
        kind: WorkbenchContractKind.GenericWork,
        requiresUserAcceptance: true,
      },
    });

    expect(second.task.id).not.toBe(first.task.id);
    expect(second.task.contract.kind).toBe(WorkbenchContractKind.GenericWork);
    expect(service.getDetail(first.task.id)?.task.status).toBe(WorkbenchTaskStatus.Cancelled);
    expect(service.getDetail(first.task.id)?.runs[0].status).toBe(WorkbenchRunStatus.Paused);
  } finally {
    db.close();
  }
});

test('explicit retry creates an incremented run under the same completed task', async () => {
  const { db, service } = createService();
  try {
    const first = service.beginRun({ sessionId: 'session', goal: 'first', contract: chatContract });
    await service.completeRun({
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

test('reports only running workbench runs as eligible for continuation', async () => {
  const { db, service } = createService();
  try {
    const { run } = service.beginRun({
      sessionId: 'session',
      goal: 'write',
      contract: chatContract,
    });

    expect(service.isRunRunning(run.id)).toBe(true);
    service.pauseRun('session', 'Paused for test.');
    expect(service.isRunRunning(run.id)).toBe(false);
    expect(service.isRunRunning('missing-run')).toBe(false);
  } finally {
    db.close();
  }
});

test('deleting a session resolves pending approvals before removing their records', async () => {
  const { db, service } = createService();
  try {
    const { run } = service.beginRun({
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

    service.deleteSession('session');

    await expect(authorization).resolves.toEqual({
      allow: false,
      reason: 'The session was deleted.',
    });
    expect(service.getCurrent('session')).toBeNull();
  } finally {
    db.close();
  }
});
