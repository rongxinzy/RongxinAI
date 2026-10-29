import Database from 'better-sqlite3';
import { afterEach, expect, test, vi } from 'vitest';

import { MemoryKind } from '../../shared/memory';
import { MemoryOutboxStatus } from './constants';
import { ProjectMemoryService } from './projectMemoryService';
import { MemoryRepository } from './repository';

afterEach(() => vi.useRealTimers());

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
  await service.stopOutboxScheduler();
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
  await service.stopOutboxScheduler();
});
