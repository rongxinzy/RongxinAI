import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import { MemoryOutboxOperation, MemoryOutboxStatus } from './constants';
import { processMemoryOutboxItem } from './memoryOutboxProcessor';
import { MemoryRepository } from './repository';
import { getSessionFinalization } from './sessionLifecycleRepository';

function databaseWithSessions(): Database.Database {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE cowork_sessions (id TEXT PRIMARY KEY);
    INSERT INTO cowork_sessions (id) VALUES ('session-1'), ('session-2');
  `);
  return database;
}

function inputs() {
  return [
    { sessionId: 'session-1', projectId: 'project-a', summary: 'summary-1' },
    { sessionId: 'session-2', projectId: 'project-a', summary: 'summary-2' },
  ];
}

test('close intents and single or batch session deletion commit atomically', () => {
  const database = databaseWithSessions();
  const repository = new MemoryRepository(database);
  repository.lifecycle.saveRuntimeSessionId({
    localSessionId: 'session-1',
    runtimeSessionId: 'session-1:resume:2',
    projectId: 'project-a',
    projectRoot: '/work',
  });

  repository.lifecycle.queueSessionFinalizations(inputs(), () => {
    database
      .prepare('DELETE FROM cowork_sessions WHERE id IN (?, ?)')
      .run('session-1', 'session-2');
  });

  expect(database.prepare('SELECT COUNT(*) AS count FROM cowork_sessions').get()).toEqual({
    count: 0,
  });
  expect(repository.listPending()).toHaveLength(2);
  expect(repository.listPending().map(item => item.operation)).toEqual([
    MemoryOutboxOperation.FinalizeSession,
    MemoryOutboxOperation.FinalizeSession,
  ]);
  expect(repository.listPending()[0].payload.runtimeSessionId).toBe('session-1:resume:2');
  expect(repository.lifecycle.getLocalSessionIdByRuntimeId('session-1:resume:2')).toBe('session-1');
  expect(getSessionFinalization(database, 'session-1:resume:2')?.status).toBe(
    MemoryOutboxStatus.Pending,
  );
});

test('an outbox failure rolls back both close intent and session deletion', () => {
  const database = databaseWithSessions();
  const repository = new MemoryRepository(database);
  database.exec(`
    CREATE TRIGGER reject_finalize_outbox BEFORE INSERT ON memory_outbox
    BEGIN SELECT RAISE(ABORT, 'close rejected'); END;
  `);

  expect(() =>
    repository.lifecycle.queueSessionFinalizations(inputs().slice(0, 1), () => {
      database.prepare('DELETE FROM cowork_sessions WHERE id = ?').run('session-1');
    }),
  ).toThrow('close rejected');
  expect(database.prepare('SELECT COUNT(*) AS count FROM cowork_sessions').get()).toEqual({
    count: 2,
  });
  expect(getSessionFinalization(database, 'session-1')).toBeNull();
});

test('finalize completion and uncertain failure update durable intent distinctly', async () => {
  const database = databaseWithSessions();
  const repository = new MemoryRepository(database);
  repository.lifecycle.queueSessionFinalizations(inputs(), () => {
    database
      .prepare('DELETE FROM cowork_sessions WHERE id IN (?, ?)')
      .run('session-1', 'session-2');
  });
  const pending = repository.listPending();
  const adapter = {
    finalizeSession: vi.fn(async () => ({
      sessionId: 'session-1',
      state: 'finalized',
      summaryId: 17,
      alreadyFinalized: false,
    })),
  };
  await processMemoryOutboxItem(repository, adapter as never, pending[0]);
  expect(getSessionFinalization(database, 'session-1')?.status).toBe(MemoryOutboxStatus.Completed);

  const unavailable = { finalizeSession: vi.fn(async () => null) };
  await processMemoryOutboxItem(repository, unavailable as never, pending[1]);
  expect(getSessionFinalization(database, 'session-2')?.status).toBe(MemoryOutboxStatus.Pending);

  repository.makePendingAvailable();
  const failed = {
    finalizeSession: vi.fn(async () => {
      throw new Error('socket timeout');
    }),
  };
  await processMemoryOutboxItem(repository, failed as never, repository.listPending()[0]);
  expect(getSessionFinalization(database, 'session-2')?.status).toBe(MemoryOutboxStatus.Failed);
  expect(repository.listPending()).toHaveLength(0);
});

test('finalize waits for an earlier checkpoint even while it is in backoff', async () => {
  const database = new Database(':memory:');
  const repository = new MemoryRepository(database);
  repository.saveSessionCheckpoint({
    id: 'checkpoint-old',
    sessionId: 'session-1',
    projectId: 'project-a',
    projectRoot: '/work',
    summary: 'old checkpoint',
    expiresAt: '2026-12-01T00:00:00.000Z',
  });
  const checkpoint = repository.listPending()[0];
  repository.markRetry(checkpoint.id, 1, 'temporary failure');
  repository.lifecycle.queueSessionFinalizations(
    [{ sessionId: 'session-1', projectId: 'project-a', summary: 'final summary' }],
    () => {},
  );
  const close =
    repository
      .listPending()
      .find(item => item.operation === MemoryOutboxOperation.FinalizeSession) ?? null;
  const calls: string[] = [];
  const adapter = {
    saveCandidate: vi.fn((input: Record<string, unknown>) => ({ id: 'candidate', ...input })),
    confirmMemory: vi.fn(async () => {
      calls.push('checkpoint');
      return 42;
    }),
    finalizeSession: vi.fn(async () => {
      calls.push('finalize');
      return { sessionId: 'session-1', state: 'finalized', summaryId: 17, alreadyFinalized: false };
    }),
  };

  await processMemoryOutboxItem(repository, adapter as never, close);
  expect(adapter.finalizeSession).not.toHaveBeenCalled();
  expect(getSessionFinalization(database, 'session-1')?.status).toBe(MemoryOutboxStatus.Pending);

  repository.makePendingAvailable();
  await processMemoryOutboxItem(repository, adapter as never, checkpoint);
  repository.makePendingAvailable();
  await processMemoryOutboxItem(repository, adapter as never, close);
  expect(calls).toEqual(['checkpoint', 'finalize']);
});

test('all runtime identities retain their local owner while only the current pointer advances', () => {
  const repository = new MemoryRepository(new Database(':memory:'));
  for (const runtimeSessionId of ['session-1:resume:1', 'session-1:resume:2']) {
    repository.lifecycle.saveRuntimeSessionId({
      localSessionId: 'session-1',
      runtimeSessionId,
      projectId: 'project-a',
      projectRoot: '/work',
    });
  }
  repository.lifecycle.saveRuntimeSessionId({
    localSessionId: 'session-1',
    runtimeSessionId: 'session-1:resume:2',
    projectId: 'project-a',
    projectRoot: '/work',
  });
  repository.lifecycle.saveRuntimeSessionId({
    localSessionId: 'session-1',
    runtimeSessionId: 'session-1:resume:1',
    projectId: 'project-a',
    projectRoot: '/work',
    makeCurrent: false,
  });

  expect(repository.lifecycle.getRuntimeSessionId('session-1')).toBe('session-1:resume:2');
  expect(repository.lifecycle.getLocalSessionIdByRuntimeId('session-1:resume:1')).toBe('session-1');
  expect(repository.lifecycle.getLocalSessionIdByRuntimeId('session-1:resume:2')).toBe('session-1');
});

test('schema v4 migration preserves the current identity and permits later continuations', () => {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE schema_migrations (scope TEXT PRIMARY KEY, version INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    INSERT INTO schema_migrations (scope, version, updated_at) VALUES ('memory', 3, 1);
    CREATE TABLE memory_runtime_sessions (
      local_session_id TEXT PRIMARY KEY,
      runtime_session_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL,
      project_root TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO memory_runtime_sessions (
      local_session_id, runtime_session_id, project_id, project_root, updated_at
    ) VALUES ('session-1', 'session-1:resume:1', 'project-a', '/work', '2026-10-29T00:00:00Z');
  `);
  const repository = new MemoryRepository(database);

  expect(repository.lifecycle.getRuntimeSessionId('session-1')).toBe('session-1:resume:1');
  repository.lifecycle.saveRuntimeSessionId({
    localSessionId: 'session-1',
    runtimeSessionId: 'session-1:resume:2',
    projectId: 'project-a',
    projectRoot: '/work',
  });
  expect(repository.lifecycle.getRuntimeSessionId('session-1')).toBe('session-1:resume:2');
  expect(repository.lifecycle.getLocalSessionIdByRuntimeId('session-1:resume:1')).toBe('session-1');
  expect(
    database.prepare("SELECT version FROM schema_migrations WHERE scope = 'memory'").get(),
  ).toEqual({ version: 4 });
});

test('finalize follows the continuation resolved by the covered checkpoint', async () => {
  const database = new Database(':memory:');
  const repository = new MemoryRepository(database);
  repository.lifecycle.saveRuntimeSessionId({
    localSessionId: 'session-1',
    runtimeSessionId: 'session-1',
    projectId: 'project-a',
    projectRoot: '/work',
  });
  repository.lifecycle.queueSessionFinalizations(
    [{ sessionId: 'session-1', projectId: 'project-a', summary: 'summary' }],
    () => {},
  );
  repository.lifecycle.saveRuntimeSessionId({
    localSessionId: 'session-1',
    runtimeSessionId: 'session-1:resume:2',
    projectId: 'project-a',
    projectRoot: '/work',
  });
  const adapter = {
    finalizeSession: vi.fn(async () => ({
      sessionId: 'session-1:resume:2',
      state: 'finalized',
      summaryId: 17,
      alreadyFinalized: false,
    })),
  };

  await processMemoryOutboxItem(repository, adapter as never, repository.listPending()[0]);

  expect(adapter.finalizeSession).toHaveBeenCalledWith({
    sessionId: 'session-1:resume:2',
    project: 'project-a',
    summary: 'summary',
  });
  expect(getSessionFinalization(database, 'session-1:resume:2')?.status).toBe(
    MemoryOutboxStatus.Completed,
  );
  expect(getSessionFinalization(database, 'session-1')).toBeNull();
  expect(repository.listPending()).toHaveLength(0);

  repository.lifecycle.queueSessionFinalizations(
    [{ sessionId: 'session-1', projectId: 'project-a', summary: 'summary' }],
    () => {},
  );
  expect(repository.listPending()).toHaveLength(0);
});

test('a completed close does not suppress finalization after resumed work', async () => {
  const database = new Database(':memory:');
  const repository = new MemoryRepository(database);
  repository.lifecycle.saveRuntimeSessionId({
    localSessionId: 'session-1',
    runtimeSessionId: 'session-1',
    projectId: 'project-a',
    projectRoot: '/work',
  });
  const adapter = {
    finalizeSession: vi.fn(async () => ({
      sessionId: 'session-1',
      state: 'finalized',
      summaryId: 17,
      alreadyFinalized: false,
    })),
  };
  const close = (summary: string) => {
    repository.lifecycle.queueSessionFinalizations(
      [{ sessionId: 'session-1', projectId: 'project-a', summary }],
      () => {},
    );
  };
  close('first close');
  await processMemoryOutboxItem(repository, adapter as never, repository.listPending()[0]);
  expect(getSessionFinalization(database, 'session-1')?.status).toBe(MemoryOutboxStatus.Completed);

  repository.saveSessionCheckpoint({
    id: 'resumed-checkpoint',
    sessionId: 'session-1',
    projectId: 'project-a',
    projectRoot: '/work',
    summary: 'resumed work',
    expiresAt: '2026-12-01T00:00:00.000Z',
  });
  close('close resumed lifecycle');
  expect(getSessionFinalization(database, 'session-1')?.status).toBe(MemoryOutboxStatus.Completed);
  expect(
    repository
      .listPending()
      .filter(item => item.operation === MemoryOutboxOperation.FinalizeSession),
  ).toHaveLength(1);

  const checkpoint = repository.listPending().find(item => item.linkId === 'resumed-checkpoint');
  if (!checkpoint) throw new Error('Expected a resumed checkpoint.');
  repository.markCompleted(checkpoint.id);
  repository.lifecycle.saveRuntimeSessionId({
    localSessionId: 'session-1',
    runtimeSessionId: 'session-1:resume:2',
    projectId: 'project-a',
    projectRoot: '/work',
  });
  const resumedClose = repository
    .listPending()
    .find(item => item.operation === MemoryOutboxOperation.FinalizeSession);
  await processMemoryOutboxItem(repository, adapter as never, resumedClose ?? null);

  expect(adapter.finalizeSession).toHaveBeenCalledTimes(2);
  expect(adapter.finalizeSession).toHaveBeenLastCalledWith({
    sessionId: 'session-1:resume:2',
    project: 'project-a',
    summary: 'close resumed lifecycle',
  });
  expect(getSessionFinalization(database, 'session-1')?.status).toBe(MemoryOutboxStatus.Completed);
  expect(getSessionFinalization(database, 'session-1:resume:2')?.status).toBe(
    MemoryOutboxStatus.Completed,
  );

  close('duplicate close with no new work');
  expect(adapter.finalizeSession).toHaveBeenCalledTimes(2);
});
