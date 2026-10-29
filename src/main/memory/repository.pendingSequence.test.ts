import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import { MemoryKind, MemoryScope, MemorySourceKind } from '../../shared/memory';
import { MemoryOutboxOperation, MemoryOutboxStatus } from './constants';
import { processMemoryOutboxItem } from './memoryOutboxProcessor';
import { MemoryRepository, type MemoryOutboxItem } from './repository';

function legacyItem(id: string, linkId: string, sequence: number): MemoryOutboxItem {
  return {
    id,
    linkId,
    operation: MemoryOutboxOperation.SessionSummary,
    payload: {
      sessionId: 'session-1',
      projectId: 'project-a',
      projectRoot: '/work',
      type: MemoryKind.SessionSummary,
      title: 'Session summary',
      content: linkId,
      topicKey: 'session/session-1',
      sourceKind: MemorySourceKind.SessionSummary,
      scope: MemoryScope.Session,
      linkId,
      metadata: { checkpointSequence: sequence },
    },
    status: MemoryOutboxStatus.Pending,
    attempts: 0,
    availableAt: new Date(0).toISOString(),
    lastError: null,
  };
}

function adapter() {
  return {
    saveCandidate: vi.fn((input: Record<string, unknown>) => ({ id: 'candidate', ...input })),
    confirmMemory: vi.fn(async () => 17),
  };
}

test('a pending newer checkpoint does not discard an unsent older legacy checkpoint', async () => {
  const repository = new MemoryRepository(new Database(':memory:'));
  const newer = legacyItem('outbox-new', 'link-new', 3);
  const older = legacyItem('outbox-old', 'link-old', 1);
  repository.enqueue(newer.operation, newer.payload, 'link-new');
  repository.enqueue(older.operation, older.payload, 'link-old');

  expect(repository.maxSessionCheckpointSequence('session-1')).toBe(3);
  const remote = adapter();
  await processMemoryOutboxItem(repository, remote as never, repository.listPending()[1]);

  expect(remote.confirmMemory).toHaveBeenCalledTimes(1);
  expect(repository.getLink('link-old')?.memoryId).toBe(17);
  expect(repository.listPending().map(item => item.linkId)).toEqual(['link-new']);
});

test('a confirmed newer legacy revision supersedes rather than reports an old retry as synced', async () => {
  const repository = new MemoryRepository(new Database(':memory:'));
  const newer = legacyItem('outbox-new', 'link-new', 3);
  const older = legacyItem('outbox-old', 'link-old', 1);
  repository.enqueue(newer.operation, newer.payload, 'link-new');
  repository.enqueue(older.operation, older.payload, 'link-old');
  const remote = adapter();
  await processMemoryOutboxItem(repository, remote as never, repository.listPending()[0]);
  await processMemoryOutboxItem(repository, remote as never, repository.listPending()[0]);

  expect(remote.confirmMemory).toHaveBeenCalledTimes(1);
  expect(repository.getLink('link-old')).toBeNull();
  expect(repository.listPending()).toHaveLength(0);
  expect(repository.getSessionCheckpoint('link-old')).toBeNull();
});
