import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import { MemoryScope } from '../../shared/memory';
import { MemoryOutboxOperation, MemoryOutboxStatus } from './constants';
import { processMemoryOutboxItem } from './memoryOutboxProcessor';
import { MemoryRepository } from './repository';

test('checkpoint sequence covers pending outbox payloads and rejects older retries', async () => {
  const repository = new MemoryRepository(new Database(':memory:'));
  repository.enqueue(
    MemoryOutboxOperation.SessionSummary,
    {
      sessionId: 'session-1',
      projectId: 'project-a',
      projectRoot: '/work',
      type: 'session_summary',
      title: 'Session summary',
      content: 'older checkpoint',
      topicKey: 'session/session-1',
      sourceKind: 'session_summary',
      scope: MemoryScope.Session,
      linkId: 'link-older',
      metadata: { checkpointSequence: 3 },
    },
    'link-older',
  );

  expect(repository.maxSessionCheckpointSequence('session-1')).toBe(3);

  const item = {
    id: 'outbox-old',
    operation: MemoryOutboxOperation.SessionSummary,
    payload: {
      sessionId: 'session-1',
      projectId: 'project-a',
      projectRoot: '/work',
      type: 'session_summary',
      title: 'Session summary',
      content: 'older checkpoint',
      topicKey: 'session/session-1',
      sourceKind: 'session_summary',
      scope: MemoryScope.Session,
      linkId: 'link-old',
      metadata: { checkpointSequence: 1 },
    },
    status: MemoryOutboxStatus.Pending,
    attempts: 0,
    availableAt: new Date(0).toISOString(),
    lastError: null,
  };
  const adapter = { saveCandidate: vi.fn(), confirmMemory: vi.fn() };
  await processMemoryOutboxItem(repository, adapter as never, item);

  expect(adapter.confirmMemory).not.toHaveBeenCalled();
  const pending = repository.listPending();
  expect(pending).toHaveLength(1);
  expect(pending[0].linkId).toBe('link-older');
  expect(pending[0].payload.metadata).toEqual({ checkpointSequence: 3 });
});
