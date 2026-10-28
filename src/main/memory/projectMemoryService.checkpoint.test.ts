import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import { MemoryOutboxStatus } from './constants';
import { processMemoryOutboxItem } from './memoryOutboxProcessor';
import { ProjectMemoryService } from './projectMemoryService';
import { MemoryRepository } from './repository';

const identityFor = (cwd: string) => ({ id: 'project-a', displayName: cwd, root: cwd });

function offlineService(repository: MemoryRepository): ProjectMemoryService {
  return new ProjectMemoryService(
    repository,
    {
      saveCandidate: vi.fn(),
      confirmMemory: vi.fn(() => new Promise<null>(() => {})),
    } as never,
    identityFor,
    '/personal',
  );
}

test('offline checkpoints have distinct sequences and an older retry cannot roll back a newer one', async () => {
  const database = new Database(':memory:');
  const repository = new MemoryRepository(database);
  const offline = offlineService(repository);
  await offline.saveSessionSummary({
    sessionId: 'session-1',
    workingDirectory: '/work',
    summary: 'checkpoint A',
    linkId: 'checkpoint-a',
  });
  await offline.saveSessionSummary({
    sessionId: 'session-1',
    workingDirectory: '/work',
    summary: 'checkpoint B',
    linkId: 'checkpoint-b',
  });

  const pending = repository.listPending();
  expect(pending.map(item => item.payload.metadata)).toEqual([
    { checkpointSequence: 1 },
    { checkpointSequence: 2 },
  ]);
  const adapter = {
    saveCandidate: vi.fn((input: Record<string, unknown>) => ({ id: 'candidate', ...input })),
    confirmMemory: vi.fn(async () => 22),
  };
  const newer = pending.find(item => item.linkId === 'checkpoint-b') ?? null;
  const older = pending.find(item => item.linkId === 'checkpoint-a') ?? null;
  await processMemoryOutboxItem(repository, adapter as never, newer);
  await processMemoryOutboxItem(repository, adapter as never, older);

  expect(adapter.confirmMemory).toHaveBeenCalledTimes(1);
  expect(adapter.confirmMemory).toHaveBeenCalledWith(
    expect.objectContaining({ operationId: 'checkpoint-b' }),
    '/work',
  );
  expect(repository.getLink('checkpoint-a')).toBeNull();
  expect(repository.getLink('checkpoint-b')?.content).toBe('checkpoint B');
  const recoveredRepository = new MemoryRepository(database);
  const recovered = new ProjectMemoryService(
    recoveredRepository,
    adapter as never,
    identityFor,
    '/personal',
  );
  await recovered.retryPendingOutbox();
  expect(adapter.confirmMemory).toHaveBeenCalledTimes(1);
  expect(
    recovered.getActiveSessionSummary({ sessionId: 'session-1', workingDirectory: '/work' }),
  ).toMatchObject({ content: 'checkpoint B', metadata: { checkpointSequence: 2 } });
});

test('replaying a stable checkpoint id does not rewrite immutable content', async () => {
  const repository = new MemoryRepository(new Database(':memory:'));
  const service = offlineService(repository);
  const input = {
    sessionId: 'session-1',
    workingDirectory: '/work',
    summary: 'original',
    linkId: 'checkpoint-stable',
  };
  await service.saveSessionSummary(input);
  await service.saveSessionSummary({ ...input, summary: 'replacement' });

  expect(repository.listPending()).toHaveLength(1);
  expect(repository.getSessionCheckpoint(input.linkId)).toMatchObject({
    content: 'original',
    sequence: 1,
    syncStatus: MemoryOutboxStatus.Pending,
  });
});
