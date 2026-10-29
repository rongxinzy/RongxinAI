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

test('immutable checkpoints retain independently recallable history', async () => {
  const repository = new MemoryRepository(new Database(':memory:'));
  const offline = offlineService(repository);
  for (const [linkId, summary] of [
    ['checkpoint-a', 'invoiceworkbook'],
    ['checkpoint-b', 'gitbranch'],
  ] as const) {
    await offline.saveSessionSummary({
      sessionId: 'session-1',
      workingDirectory: '/work',
      summary,
      linkId,
      metadata: { format: 'agent-checkpoint' },
    });
  }

  const pending = repository.listPending();
  expect(pending.map(item => item.payload.metadata)).toEqual([
    { format: 'agent-checkpoint', checkpointSequence: 1 },
    { format: 'agent-checkpoint', checkpointSequence: 2 },
  ]);
  expect(pending.map(item => item.payload.topicKey)).toEqual([
    'session/session-1/checkpoint/checkpoint-a',
    'session/session-1/checkpoint/checkpoint-b',
  ]);
  const adapter = {
    saveCandidate: vi.fn((input: Record<string, unknown>) => ({ id: 'candidate', ...input })),
    confirmMemory: vi.fn(async (candidate: { content: string }) =>
      candidate.content === 'invoiceworkbook' ? 21 : 22,
    ),
    recall: vi.fn(async (input: { query: string }) =>
      [
        { id: 21, session_id: 'session-1', content: 'invoiceworkbook' },
        { id: 22, session_id: 'session-1', content: 'gitbranch' },
      ].filter(observation => observation.content.includes(input.query)),
    ),
  };
  const service = new ProjectMemoryService(repository, adapter as never, identityFor, '/personal');
  await processMemoryOutboxItem(repository, adapter as never, pending[1]);
  await processMemoryOutboxItem(repository, adapter as never, pending[0]);

  expect(adapter.confirmMemory).toHaveBeenCalledTimes(2);
  expect(repository.getLink('checkpoint-a')?.memoryId).toBe(21);
  expect(repository.getLink('checkpoint-b')?.memoryId).toBe(22);
  expect(
    (
      await service.recallSession({
        sessionId: 'session-1',
        workingDirectory: '/work',
        query: 'invoiceworkbook',
      })
    ).map(observation => observation.id),
  ).toEqual([21]);
  expect(
    (
      await service.recallSession({
        sessionId: 'session-1',
        workingDirectory: '/work',
        query: 'gitbranch',
      })
    ).map(observation => observation.id),
  ).toEqual([22]);
  expect(
    service.getActiveSessionSummary({ sessionId: 'session-1', workingDirectory: '/work' }),
  ).toMatchObject({ content: 'gitbranch', metadata: { checkpointSequence: 2 } });
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
