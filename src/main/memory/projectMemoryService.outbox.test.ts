import Database from 'better-sqlite3';
import { setImmediate as nextTick } from 'node:timers/promises';
import { afterEach, expect, test, vi } from 'vitest';

import { MemoryKind } from '../../shared/memory';
import { MemoryOutboxStatus } from './constants';
import { ProjectMemoryService } from './projectMemoryService';
import { MemoryRepository } from './repository';

afterEach(() => vi.useRealTimers());

test('wakes the outbox only after committing a deletion with session snapshots', async () => {
  vi.useFakeTimers();
  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);
  const service = new ProjectMemoryService(
    repository,
    {} as never,
    cwd => ({ id: cwd === '/work' ? 'project-a' : 'project-b', displayName: cwd, root: cwd }),
    '/personal',
  );
  const transactionsAtDrain: boolean[] = [];
  vi.spyOn(service, 'drainOutbox').mockImplementation(async () => {
    transactionsAtDrain.push(db.inTransaction);
    return 0;
  });
  try {
    db.exec(`
      CREATE TABLE cowork_sessions (id TEXT PRIMARY KEY);
      INSERT INTO cowork_sessions (id) VALUES ('session-1');
      CREATE TRIGGER reject_finalize_outbox BEFORE INSERT ON memory_outbox
      BEGIN SELECT RAISE(ABORT, 'close rejected'); END;
    `);
    const deleteSessions = () => {
      db.prepare('DELETE FROM cowork_sessions WHERE id = ?').run('session-1');
      return [{ sessionId: 'session-1', workingDirectory: '/work', summary: 'last answer' }];
    };
    service.startOutboxScheduler();
    await vi.advanceTimersByTimeAsync(0);
    transactionsAtDrain.length = 0;

    expect(service.finalizeSessionsForDeletion(() => null)).toBeNull();
    expect(service.finalizeSessionsForDeletion(() => [])).toEqual([]);
    expect(() => service.finalizeSessionsForDeletion(deleteSessions)).toThrow('close rejected');
    expect(db.prepare('SELECT id FROM cowork_sessions').get()).toEqual({ id: 'session-1' });
    expect(repository.listPending()).toEqual([]);
    expect(transactionsAtDrain).toEqual([]);

    db.exec('DROP TRIGGER reject_finalize_outbox');
    expect(service.finalizeSessionsForDeletion(deleteSessions)).toEqual(['session-1']);
    expect(db.prepare('SELECT id FROM cowork_sessions').get()).toBeUndefined();
    expect(transactionsAtDrain).toEqual([false]);
    expect(repository.listPending()[0]?.payload).toEqual({
      sessionId: 'session-1',
      runtimeSessionId: 'session-1',
    });
    expect(
      db.prepare('SELECT project_id, summary FROM memory_session_finalizations').get(),
    ).toEqual({
      project_id: 'project-a',
      summary: 'last answer',
    });
  } finally {
    await service.shutdown();
    db.close();
  }
});

test('waits for an admitted native session registration to persist before shutdown completes', async () => {
  vi.useFakeTimers();
  const db = new Database(':memory:');
  try {
    const repository = new MemoryRepository(db);
    const nativeResponse = Promise.withResolvers<string>();
    const resumeSession = vi.fn(() => nativeResponse.promise);
    const service = new ProjectMemoryService(
      repository,
      { resumeSession } as never,
      cwd => ({ id: 'project-a', displayName: cwd, root: cwd }),
      '/personal',
    );
    const registration = service.registerSession('session-1', '/work');
    const drained = vi.fn();
    const stopping = service.shutdown().then(drained);
    await service.registerSession('session-too-late', '/work');
    expect(resumeSession).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    const stoppedBeforeReply = drained.mock.calls.length > 0;
    expect(repository.lifecycle.getRuntimeSessionId('session-1')).toBeNull();
    nativeResponse.resolve('native-session-1');
    await Promise.all([registration, stopping]);
    expect(repository.lifecycle.getRuntimeSessionId('session-1')).toBe('native-session-1');
    expect(stoppedBeforeReply).toBe(false);
  } finally {
    db.close();
  }
});

test('deletion waits for registration of the same session before sending its close intent', async () => {
  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);
  const registration = Promise.withResolvers<string>();
  const finalizeSession = vi.fn(async () => ({ summaryId: 42 }));
  const service = new ProjectMemoryService(
    repository,
    { resumeSession: () => registration.promise, finalizeSession } as never,
    cwd => ({ id: 'project-a', displayName: cwd, root: cwd }),
    '/personal',
  );
  try {
    const registered = service.registerSession('session-1', '/work');
    expect(
      service.finalizeSessionsForDeletion(() => [
        {
          sessionId: 'session-1',
          workingDirectory: '/work',
          summary: 'last answer',
        },
      ]),
    ).toEqual(['session-1']);
    const delivery = service.drainOutbox();
    await nextTick();
    const deliveredBeforeRegistration = finalizeSession.mock.calls.length;
    registration.resolve('native-session-2');
    await Promise.all([registered, delivery]);

    expect(deliveredBeforeRegistration).toBe(0);
    expect(finalizeSession).toHaveBeenCalledExactlyOnceWith({
      sessionId: 'native-session-2',
      project: 'project-a',
      summary: 'last answer',
    });
  } finally {
    registration.resolve('native-session-2');
    await service.shutdown();
    db.close();
  }
});

test('quit drains the admitted outbox write and leaves later manual retries for restart', async () => {
  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);
  const first = Promise.withResolvers<number>();
  const entered = Promise.withResolvers<void>();
  const adapter = {
    saveCandidate: vi.fn((input: Record<string, unknown>) => ({ id: 'candidate', ...input })),
    confirmMemory: vi
      .fn(async () => 43)
      .mockImplementationOnce(() => {
        entered.resolve();
        return first.promise;
      }),
  };
  const service = new ProjectMemoryService(
    repository,
    adapter as never,
    cwd => ({ id: 'project-a', displayName: cwd, root: cwd }),
    '/personal',
  );
  try {
    for (const id of ['one', 'two']) {
      await service.saveSessionSummary({
        sessionId: id,
        workingDirectory: '/work',
        summary: id,
        linkId: id,
      });
    }
    const retry = service.retryPendingOutbox();
    await entered.promise;
    const stopping = service.shutdown();
    first.resolve(42);
    expect(await retry).toBe(1);
    await stopping;
    expect(adapter.confirmMemory).toHaveBeenCalledOnce();
    expect(repository.getSessionCheckpoint('one')?.syncStatus).toBe(MemoryOutboxStatus.Completed);
    expect(repository.getSessionCheckpoint('two')?.syncStatus).toBe(MemoryOutboxStatus.Pending);
    expect(await service.retryPendingOutbox()).toBe(0);

    const restarted = new ProjectMemoryService(
      repository,
      adapter as never,
      service.getProjectIdentity.bind(service),
      '/personal',
    );
    expect(await restarted.retryPendingOutbox()).toBe(1);
    expect(repository.getSessionCheckpoint('two')?.syncStatus).toBe(MemoryOutboxStatus.Completed);
  } finally {
    db.close();
  }
});

test('a restored runtime is retried after backoff without another checkpoint', async () => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-29T00:00:00.000Z');
  const repository = new MemoryRepository(new Database(':memory:'));
  let available = false;
  const adapter = {
    saveCandidate: vi.fn((input: Record<string, unknown>) => ({ id: 'candidate', ...input })),
    confirmMemory: vi.fn(async () => (available ? 42 : null)),
  };
  const service = new ProjectMemoryService(
    repository,
    adapter as never,
    cwd => ({ id: 'project-a', displayName: cwd, root: cwd }),
    '/personal',
  );
  await service.saveSessionSummary({
    sessionId: 'session-1',
    workingDirectory: '/work',
    summary: 'checkpoint',
    linkId: 'checkpoint-1',
  });
  service.startOutboxScheduler();
  await vi.advanceTimersByTimeAsync(1);
  expect(adapter.confirmMemory).toHaveBeenCalledTimes(1);
  expect(repository.getSessionCheckpoint('checkpoint-1')?.syncStatus).toBe(
    MemoryOutboxStatus.Pending,
  );

  available = true;
  await vi.advanceTimersByTimeAsync(120_000);
  expect(adapter.confirmMemory).toHaveBeenCalledTimes(2);
  expect(repository.getLink('checkpoint-1')?.memoryId).toBe(42);
  expect(repository.getSessionCheckpoint('checkpoint-1')?.syncStatus).toBe(
    MemoryOutboxStatus.Completed,
  );
  await service.shutdown();
});

test('explicit memory saves also resume automatically after a failure', async () => {
  vi.useFakeTimers();
  const repository = new MemoryRepository(new Database(':memory:'));
  let available = false;
  const adapter = {
    saveCandidate: vi.fn((input: Record<string, unknown>) => ({ id: 'candidate', ...input })),
    confirmMemory: vi.fn(async () => (available ? 42 : null)),
  };
  const service = new ProjectMemoryService(
    repository,
    adapter as never,
    cwd => ({ id: 'project-a', displayName: cwd, root: cwd }),
    '/personal',
  );
  service.startOutboxScheduler();
  await vi.advanceTimersByTimeAsync(1);

  await service.saveProjectMemory({
    sessionId: 'session-1',
    workingDirectory: '/work',
    type: MemoryKind.Decision,
    title: 'Decision',
    content: 'Use SQLite',
  });
  expect(adapter.confirmMemory).toHaveBeenCalledTimes(1);
  available = true;
  await vi.advanceTimersByTimeAsync(120_000);

  expect(adapter.confirmMemory).toHaveBeenCalledTimes(2);
  expect(repository.listManaged()[0]?.memoryId).toBe(42);
  await service.shutdown();
});
