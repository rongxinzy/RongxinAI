import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import {
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySourceKind,
} from '../../shared/memory';
import { MemoryOutboxOperation } from './constants';
import { processMemoryOutboxItem } from './memoryOutboxProcessor';
import { MemoryRepository } from './repository';

function forgetItem() {
  return {
    id: 'outbox-1',
    linkId: 'link-1',
    operation: MemoryOutboxOperation.Forget,
    payload: { linkId: 'link-1', observationId: 42, hardDelete: false },
    status: 'pending',
    attempts: 0,
    availableAt: '',
    lastError: null,
  };
}

test('recovers the owner of a pre-upgrade forget payload from the persisted link', async () => {
  const repository = {
    getLink: vi.fn(() => ({ projectId: 'workspace-legacy', memoryId: 42 })),
    hasOtherObservationReferences: vi.fn(() => false),
    completeForget: vi.fn(),
    markRetry: vi.fn(),
  };
  const adapter = { forget: vi.fn(async () => true) };

  await processMemoryOutboxItem(repository as never, adapter as never, forgetItem());

  expect(adapter.forget).toHaveBeenCalledWith(42, false, 'workspace-legacy');
  expect(repository.completeForget).toHaveBeenCalledWith({
    outboxId: 'outbox-1',
    linkId: 'link-1',
    hardDelete: false,
  });
  expect(repository.markRetry).not.toHaveBeenCalled();
});

test('rejects recovery when the persisted link does not match the target observation', async () => {
  const repository = {
    getLink: vi.fn(() => ({ projectId: 'workspace-legacy', memoryId: 7 })),
    markRetry: vi.fn(),
  };
  const adapter = { forget: vi.fn(async () => true) };

  const result = await processMemoryOutboxItem(repository as never, adapter as never, forgetItem());

  expect(result).toBeNull();
  expect(adapter.forget).not.toHaveBeenCalled();
  expect(repository.markRetry).toHaveBeenCalledWith(
    'outbox-1',
    1,
    'Cannot resolve a trusted project owner for forget of link link-1.',
  );
});

test('deleting a historical link preserves a shared current observation', async () => {
  const repository = new MemoryRepository(new Database(':memory:'));
  for (const id of ['checkpoint-a', 'checkpoint-b']) {
    repository.createLink({
      id,
      memoryId: 42,
      projectId: 'project-a',
      scope: MemoryScope.Session,
      sessionId: 'session-1',
      sourceKind: MemorySourceKind.SessionSummary,
      title: 'Session summary',
      content: id,
      kind: MemoryKind.SessionSummary,
      topicKey: 'session/session-1',
    });
  }
  repository.setLinkStatus('checkpoint-a', MemoryLifecycleStatus.Superseded, 'checkpoint-b');
  repository.setLinkStatus('checkpoint-a', MemoryLifecycleStatus.Deleted);
  repository.enqueue(
    MemoryOutboxOperation.Forget,
    { linkId: 'checkpoint-a', observationId: 42, hardDelete: true, projectId: 'project-a' },
    'checkpoint-a',
  );
  const adapter = { forget: vi.fn(async () => true) };

  await processMemoryOutboxItem(repository, adapter as never, repository.listPending()[0]);

  expect(adapter.forget).not.toHaveBeenCalled();
  expect(repository.getLink('checkpoint-a')).toBeNull();
  expect(repository.getLink('checkpoint-b')?.status).toBe(MemoryLifecycleStatus.Active);
  expect(repository.listPending()).toHaveLength(0);
});
