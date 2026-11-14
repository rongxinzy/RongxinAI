import { expect, test, vi } from 'vitest';
import { MemoryScope } from '../../shared/memory';
import { recallMemoryScope } from './memoryRecallSupport';

test('an empty local index is an empty recall branch', async () => {
  const backend = { recall: vi.fn(async () => []), recent: vi.fn(async () => []) };
  const repository = {
    filterRecallableMemoryIds: () => new Set(),
    getRecallMetadata: () => new Map(),
  };
  await expect(
    recallMemoryScope(repository as never, backend as never, {
      query: '发票',
      projectId: 'workspace-without-records',
      scope: MemoryScope.Personal,
    }),
  ).resolves.toEqual([]);
});
test('storage failures remain observable rather than becoming empty recall results', async () => {
  const backend = {
    recall: vi.fn(async () => {
      throw new Error('database is locked');
    }),
    recent: vi.fn(),
  };
  await expect(
    recallMemoryScope({} as never, backend as never, {
      query: '发票',
      projectId: 'workspace-a',
      scope: MemoryScope.Project,
    }),
  ).rejects.toThrow('database is locked');
});
