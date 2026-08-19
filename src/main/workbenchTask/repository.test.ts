import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import {
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactKind,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
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
  requiresUserAcceptance: false,
};

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
    repository.appendRunEvent(first.id, WorkbenchRunEventType.RunStarted);
    repository.appendRunEvent(first.id, WorkbenchRunEventType.VerificationStarted);

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

test('deduplicates identical artifact evidence within a run', () => {
  const { db, repository } = createRepository();
  try {
    const task = repository.createTask('session', 'goal', contract);
    const run = repository.createRun(task.id, WorkbenchRunTrigger.Message);
    const artifact = {
      taskId: task.id,
      runId: run.id,
      kind: WorkbenchArtifactKind.File,
      mimeType: 'text/plain',
      reference: 'result.txt',
      contentHash: 'hash',
      provenance: WorkbenchArtifactProvenance.Workspace,
      verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
      metadata: {},
    };

    const first = repository.addArtifact(artifact);
    const duplicate = repository.addArtifact(artifact);
    expect(duplicate.id).toBe(first.id);
    expect(repository.getDetail(task.id)?.artifacts).toHaveLength(1);
  } finally {
    db.close();
  }
});

test('promotes an existing pending artifact when verified evidence arrives', () => {
  const { db, repository } = createRepository();
  try {
    const task = repository.createTask('session', 'goal', contract);
    const run = repository.createRun(task.id, WorkbenchRunTrigger.Message);
    const pending = repository.addArtifact({
      taskId: task.id,
      runId: run.id,
      kind: WorkbenchArtifactKind.File,
      mimeType: 'text/plain',
      reference: 'result.txt',
      contentHash: 'hash',
      provenance: WorkbenchArtifactProvenance.Workspace,
      verificationStatus: WorkbenchArtifactVerificationStatus.Pending,
      metadata: { role: 'deliverable' },
    });

    const verified = repository.addArtifact({
      taskId: task.id,
      runId: run.id,
      kind: WorkbenchArtifactKind.File,
      mimeType: 'text/plain',
      reference: 'result.txt',
      contentHash: 'hash',
      provenance: WorkbenchArtifactProvenance.Controller,
      verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
      metadata: { verifier: 'production_inspection' },
    });

    expect(verified).toMatchObject({
      id: pending.id,
      provenance: WorkbenchArtifactProvenance.Controller,
      verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
      metadata: { role: 'deliverable', verifier: 'production_inspection' },
    });
    expect(repository.getDetail(task.id)?.artifacts).toHaveLength(1);
  } finally {
    db.close();
  }
});

test('preserves declared identity when pending tool evidence is deduplicated', () => {
  const { db, repository } = createRepository();
  try {
    const task = repository.createTask('session', 'goal', contract);
    const run = repository.createRun(task.id, WorkbenchRunTrigger.Message);
    const declared = repository.addArtifact({
      taskId: task.id,
      runId: run.id,
      kind: WorkbenchArtifactKind.File,
      mimeType: 'text/markdown',
      reference: 'result.md',
      contentHash: 'hash',
      provenance: WorkbenchArtifactProvenance.Workspace,
      verificationStatus: WorkbenchArtifactVerificationStatus.Pending,
      metadata: {
        source: WorkbenchArtifactCandidateSource.Declaration,
        role: 'deliverable',
        title: 'Final report',
      },
    });

    const duplicate = repository.addArtifact({
      taskId: task.id,
      runId: run.id,
      kind: WorkbenchArtifactKind.File,
      mimeType: 'text/markdown',
      reference: 'result.md',
      contentHash: 'hash',
      provenance: WorkbenchArtifactProvenance.Workspace,
      verificationStatus: WorkbenchArtifactVerificationStatus.Pending,
      metadata: { source: WorkbenchArtifactCandidateSource.ToolEffect },
    });

    expect(duplicate).toMatchObject({
      id: declared.id,
      verificationStatus: WorkbenchArtifactVerificationStatus.Pending,
      metadata: {
        source: WorkbenchArtifactCandidateSource.Declaration,
        role: 'deliverable',
        title: 'Final report',
      },
    });
    expect(repository.getDetail(task.id)?.artifacts).toHaveLength(1);
  } finally {
    db.close();
  }
});
