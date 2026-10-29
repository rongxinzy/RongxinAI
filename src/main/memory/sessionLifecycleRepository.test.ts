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
