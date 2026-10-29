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

function enqueueConfirmation(repository: MemoryRepository, linkId = 'link-1'): void {
  repository.enqueue(
    MemoryOutboxOperation.Confirm,
    {
      sessionId: 'session-1',
      projectId: 'project-a',
      projectRoot: '/work',
      type: MemoryKind.Decision,
      title: 'title',
      content: 'content',
      sourceKind: MemorySourceKind.Explicit,
      scope: MemoryScope.Project,
      linkId,
    },
    linkId,
  );
}

function adapter() {
  return {
    saveCandidate: vi.fn((input: Record<string, unknown>) => ({ id: 'candidate', ...input })),
    confirmMemory: vi.fn(async () => 42),
  };
}

test('a local completion failure rolls back the entire confirmation', async () => {
  const database = new Database(':memory:');
  const repository = new MemoryRepository(database);
  enqueueConfirmation(repository);
  database.exec(`
    CREATE TRIGGER reject_outbox_completion BEFORE UPDATE ON memory_outbox
    WHEN NEW.status = 'completed'
    BEGIN SELECT RAISE(ABORT, 'completion rejected'); END;
  `);

  await processMemoryOutboxItem(repository, adapter() as never, repository.listPending()[0]);

  expect(repository.getLink('link-1')).toBeNull();
  repository.makePendingAvailable();
  expect(repository.listPending()).toHaveLength(1);
});

test('a replay never revives a newer archive decision', async () => {
  const repository = new MemoryRepository(new Database(':memory:'));
  enqueueConfirmation(repository);
  repository.createLink({
    id: 'link-1',
    memoryId: 42,
    projectId: 'project-a',
    scope: MemoryScope.Project,
    sessionId: 'session-1',
    sourceKind: MemorySourceKind.Explicit,
    title: 'title',
    content: 'original',
    kind: MemoryKind.Decision,
  });
  repository.archiveMemory?.('link-1');
  repository.setLinkStatus('link-1', MemoryLifecycleStatus.Archived);

  await processMemoryOutboxItem(repository, adapter() as never, repository.listPending()[0]);

  expect(repository.getLink('link-1')).toMatchObject({
    status: MemoryLifecycleStatus.Archived,
    content: 'original',
  });
  expect(repository.listPending()).toHaveLength(0);
});
