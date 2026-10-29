import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import { MemoryKind, MemoryScope, MemorySourceKind } from '../../shared/memory';
import { MemoryOutboxOperation } from './constants';
import { processMemoryOutboxItem } from './memoryOutboxProcessor';
import { ProjectMemoryService } from './projectMemoryService';
import { MemoryRepository } from './repository';

const identity = (cwd: string) => ({ id: 'project-a', displayName: cwd, root: cwd });

test('concurrent direct saves and the scheduler never execute the same item twice', async () => {
  const repository = new MemoryRepository(new Database(':memory:'));
  let memoryId = 40;
  const adapter = {
    saveCandidate: vi.fn((input: Record<string, unknown>) => ({ id: 'candidate', ...input })),
    confirmMemory: vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return ++memoryId;
    }),
  };
  const service = new ProjectMemoryService(repository, adapter as never, identity, '/personal');
  service.startOutboxScheduler();

  await Promise.all([
    service.saveProjectMemory({
      sessionId: 'session-1',
      workingDirectory: '/work',
      type: MemoryKind.Decision,
      title: 'A',
      content: 'A',
    }),
    service.saveProjectMemory({
      sessionId: 'session-1',
      workingDirectory: '/work',
      type: MemoryKind.Decision,
      title: 'B',
      content: 'B',
    }),
  ]);
  await service.stopOutboxScheduler();

  expect(adapter.confirmMemory).toHaveBeenCalledTimes(2);
  expect(repository.listPending()).toHaveLength(0);
});

test('a duplicate supersede returns the result without repeating governance writes', async () => {
  const database = new Database(':memory:');
  const repository = new MemoryRepository(database);
  repository.createLink({
    id: 'old-link',
    memoryId: 41,
    projectId: 'project-a',
    scope: MemoryScope.Project,
    sessionId: 'session-old',
    sourceKind: MemorySourceKind.Explicit,
    title: 'old',
    content: 'old',
    kind: MemoryKind.Decision,
  });
  repository.enqueue(
    MemoryOutboxOperation.Supersede,
    {
      sessionId: 'session-new',
      projectId: 'project-a',
      projectRoot: '/work',
      type: MemoryKind.Decision,
      title: 'new',
      content: 'new',
      sourceKind: MemorySourceKind.Explicit,
      scope: MemoryScope.Project,
      linkId: 'new-link',
      supersedesLinkId: 'old-link',
      supersededObservationId: 41,
    },
    'new-link',
  );
  const adapter = {
    saveCandidate: vi.fn((input: Record<string, unknown>) => ({ id: 'candidate', ...input })),
    supersede: vi.fn(async () => 42),
  };
  const item = repository.listPending()[0];

  await Promise.all([
    processMemoryOutboxItem(repository, adapter as never, item),
    processMemoryOutboxItem(repository, adapter as never, item),
  ]);

  expect(adapter.supersede).toHaveBeenCalledTimes(1);
  expect(database.prepare('SELECT status, attempts, last_error FROM memory_outbox').get()).toEqual({
    status: 'completed',
    attempts: 0,
    last_error: null,
  });
});
