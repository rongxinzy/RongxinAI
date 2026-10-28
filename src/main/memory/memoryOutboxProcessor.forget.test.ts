import { expect, test, vi } from 'vitest';

import { MemoryOutboxOperation } from './constants';
import { processMemoryOutboxItem } from './memoryOutboxProcessor';

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
    getLink: vi.fn(() => {
      return { projectId: 'workspace-legacy', memoryId: 42 };
    }),
    markCompleted: vi.fn(),
    markRetry: vi.fn(),
    deleteLink: vi.fn(),
  };
  const adapter = { forget: vi.fn(async () => true) };

  await processMemoryOutboxItem(repository as never, adapter as never, forgetItem());

  expect(adapter.forget).toHaveBeenCalledWith(42, false, 'workspace-legacy');
  expect(repository.markCompleted).toHaveBeenCalledWith('outbox-1');
  expect(repository.markRetry).not.toHaveBeenCalled();
});

test('rejects recovery when the persisted link does not match the target observation', async () => {
  const repository = {
    getLink: vi.fn(() => {
      return { projectId: 'workspace-legacy', memoryId: 7 };
    }),
    markCompleted: vi.fn(),
    markRetry: vi.fn(),
    deleteLink: vi.fn(),
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
