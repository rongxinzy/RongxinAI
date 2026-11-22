import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import {
  WorkbenchArtifactKind,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
  WorkbenchExecutionStatus,
  WorkbenchRunEventType,
  WorkbenchRunTrigger,
} from '../../shared/workbenchTask';
import { WorkbenchTaskRepository } from './repository';
import { initializeWorkbenchTaskSchema } from './schema';

const createRepository = () => {
  const db = new Database(':memory:');
  initializeWorkbenchTaskSchema(db);
  return { db, repository: new WorkbenchTaskRepository(db) };
};

const contract = {
  kind: WorkbenchContractKind.Chat,
};

test('leaves retired task statuses stored without exposing them as current execution facts', () => {
  const { db, repository } = createRepository();
  try {
    const task = repository.createTask('retired-session', 'Historical task', contract);
    const run = repository.createRun(task.id, WorkbenchRunTrigger.Message);
    db.prepare('UPDATE workbench_tasks SET status = ? WHERE id = ?').run('completed', task.id);
    db.prepare('UPDATE workbench_runs SET status = ? WHERE id = ?').run('succeeded', run.id);
    expect(repository.getTask(task.id)).toBeNull();
    expect(repository.getRun(run.id)).toBeNull();
    expect(repository.getDetail(task.id)).toBeNull();
    expect(repository.getLatestTaskForSession('retired-session')).toBeNull();
    expect(repository.listTasksForSession('retired-session')).toEqual([]);
    expect(db.prepare('SELECT status FROM workbench_tasks WHERE id = ?').get(task.id)).toEqual({
      status: 'completed',
    });
    expect(db.prepare('SELECT status FROM workbench_runs WHERE id = ?').get(run.id)).toEqual({
      status: 'succeeded',
    });
    const current = repository.createTask('retired-session', 'Current execution', contract);
    expect(repository.getLatestTaskForSession('retired-session')?.id).toBe(current.id);
  } finally {
    db.close();
  }
});

test('a supported run owns task visibility when the historical task status is retired', () => {
  const { db, repository } = createRepository();
  try {
    const sessionId = 'session';
    const task = repository.createTask(sessionId, 'Retained goal', contract);
    const run = repository.createRun(task.id, WorkbenchRunTrigger.Message);
    db.prepare('UPDATE workbench_tasks SET status = ? WHERE id = ?').run('completed', task.id);
    repository.updateRunStatus(run.id, WorkbenchExecutionStatus.Running);

    const projected = {
      id: task.id,
      activeRunId: run.id,
      status: WorkbenchExecutionStatus.Running,
    };
    expect(repository.getDetail(task.id)?.task).toMatchObject(projected);
    expect(repository.getLatestTaskForSession(sessionId)).toMatchObject(projected);
    expect(repository.getLatestTaskStatuses([sessionId]).get(sessionId)).toBe(projected.status);
    expect(repository.getLatestRunLinkForSession(sessionId)).toEqual({
      taskId: task.id,
      runId: run.id,
    });
    expect(repository.deleteSessionDomainData([sessionId])).toEqual([{ id: task.id, sessionId }]);
    expect(repository.getRun(run.id)).toBeNull();
  } finally {
    db.close();
  }
});

test('rolls back all repository writes when a transaction fails', () => {
  const { db, repository } = createRepository();
  try {
    expect(() =>
      repository.transaction(() => {
        repository.createTask('session', 'goal', contract);
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(repository.getLatestTaskForSession('session')).toBeNull();
  } finally {
    db.close();
  }
});

test('increments attempts and run event sequences while enforcing uniqueness', () => {
  const { db, repository } = createRepository();
  try {
    const task = repository.createTask('session', 'goal', contract);
    const first = repository.createRun(task.id, WorkbenchRunTrigger.Message);
    const second = repository.createRun(task.id, WorkbenchRunTrigger.Retry);
    repository.updateRunStatus(first.id, WorkbenchExecutionStatus.Running);
    repository.appendRunEvent(first.id, WorkbenchRunEventType.ToolRead);

    expect([first.attempt, second.attempt]).toEqual([1, 2]);
    expect(
      repository
        .getDetail(task.id)
        ?.events.filter(event => event.runId === first.id)
        .map(event => event.sequence),
    ).toEqual([1, 2, 3]);
    expect(() =>
      db.prepare('UPDATE workbench_runs SET attempt = ? WHERE id = ?').run(1, second.id),
    ).toThrow();
  } finally {
    db.close();
  }
});

test('links the latest session task to its current run without falling back to older tasks', () => {
  const { db, repository } = createRepository();
  try {
    const first = repository.createTask('session', 'first', contract);
    repository.createRun(first.id, WorkbenchRunTrigger.Message);
    const next = repository.createTask('session', 'next', contract);
    db.prepare('UPDATE workbench_tasks SET created_at = 1').run();
    db.prepare('UPDATE workbench_tasks SET active_run_id = ? WHERE id = ?').run('missing', next.id);
    expect(repository.getLatestRunLinkForSession('session')).toBeNull();

    const run = repository.createRun(next.id, WorkbenchRunTrigger.Message);
    const retry = repository.createRun(next.id, WorkbenchRunTrigger.Retry);
    expect(repository.getLatestRunLinkForSession('session')).toEqual({
      taskId: next.id,
      runId: retry.id,
    });
    db.prepare('UPDATE workbench_runs SET status = ? WHERE id = ?').run('succeeded', retry.id);
    expect(repository.getLatestRunLinkForSession('session')).toEqual({
      taskId: next.id,
      runId: run.id,
    });
  } finally {
    db.close();
  }
});

test('persists the runtime context for an audit run', () => {
  const { db, repository } = createRepository();
  try {
    const task = repository.createTask('session', 'goal', contract);
    const run = repository.createRun(task.id, WorkbenchRunTrigger.Message);
    const context = {
      model: 'gpt-5',
      provider: 'openai',
      reasoningProfile: 'high',
      workspaceRoot: 'D:/workspace',
      skillIds: ['documents', 'spreadsheets'],
    };

    expect(repository.updateRunContext(run.id, context).context).toEqual(context);
    expect(repository.getDetail(task.id)?.runs[0].context).toEqual(context);
  } finally {
    db.close();
  }
});

test('adds runtime context storage to an existing workbench schema', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE workbench_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        status TEXT NOT NULL,
        trigger TEXT NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        verification_result_json TEXT,
        failure_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(task_id, attempt)
      );
    `);

    initializeWorkbenchTaskSchema(db);

    const columns = db.prepare('PRAGMA table_info(workbench_runs)').all() as Array<{
      name: string;
    }>;
    expect(columns.map(column => column.name)).toContain('context_json');
    expect(columns.map(column => column.name)).toContain('terminal_after_sequence');
  } finally {
    db.close();
  }
});

test('lists task history for one session in newest-first order', () => {
  const { db, repository } = createRepository();
  try {
    const first = repository.createTask('session', 'first goal', contract);
    const second = repository.createTask('session', 'second goal', contract);
    repository.createTask('other-session', 'unrelated goal', contract);

    db.prepare('UPDATE workbench_tasks SET created_at = ? WHERE id = ?').run(1, first.id);
    db.prepare('UPDATE workbench_tasks SET created_at = ? WHERE id = ?').run(2, second.id);

    expect(repository.listTasksForSession('session').map(task => task.id)).toEqual([
      second.id,
      first.id,
    ]);
  } finally {
    db.close();
  }
});

test('fresh databases do not create the historical artifact table', () => {
  const { db, repository } = createRepository();
  try {
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name = 'workbench_artifacts'").get(),
    ).toBeUndefined();
    const task = repository.createTask('session', 'goal', contract);
    repository.createRun(task.id, WorkbenchRunTrigger.Message);
    expect(repository.getDetail(task.id)?.artifacts).toEqual([]);
    repository.deleteSessionDomainData(['session']);
    expect(repository.getDetail(task.id)).toBeNull();
  } finally {
    db.close();
  }
});

test('loads historical artifact evidence for the audit and removes it with its session', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE workbench_artifacts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES workbench_tasks(id),
        run_id TEXT NOT NULL REFERENCES workbench_runs(id),
        kind TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        reference TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        provenance TEXT NOT NULL,
        verification_status TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    initializeWorkbenchTaskSchema(db);
    const repository = new WorkbenchTaskRepository(db);
    const task = repository.createTask('session', 'goal', contract);
    const run = repository.createRun(task.id, WorkbenchRunTrigger.Message);
    db.prepare(
      `INSERT INTO workbench_artifacts
       (id, task_id, run_id, kind, mime_type, reference, content_hash, provenance,
        verification_status, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'legacy-artifact',
      task.id,
      run.id,
      WorkbenchArtifactKind.File,
      'text/plain',
      'result.txt',
      'hash',
      WorkbenchArtifactProvenance.Workspace,
      WorkbenchArtifactVerificationStatus.Verified,
      '{"role":"deliverable"}',
      1,
      2,
    );
    expect(repository.getDetail(task.id)?.artifacts).toEqual([
      expect.objectContaining({
        id: 'legacy-artifact',
        runId: run.id,
        reference: 'result.txt',
        verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
        metadata: { role: 'deliverable' },
      }),
    ]);
    repository.deleteSessionDomainData(['session']);
    expect(db.prepare('SELECT id FROM workbench_artifacts').all()).toEqual([]);
  } finally {
    db.close();
  }
});
