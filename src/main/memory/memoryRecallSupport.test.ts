import { expect, test, vi } from 'vitest';

import { MemoryScope } from '../../shared/memory';
import { recallMemoryScope } from './memoryRecallSupport';
import { EngramRequestError } from './zhiyuanEngramAdapter';

test('treats an unknown project as an empty recall branch instead of failing', async () => {
  const adapter = {
    recall: vi.fn(async () => {
      throw new EngramRequestError(
        404,
        'GET',
        '/search',
        'unknown_project',
        '{"code":"unknown_project"}',
      );
    }),
    recent: vi.fn(),
  };
  const repository = { getRecallMetadata: vi.fn(() => new Map()) };

  await expect(
    recallMemoryScope(repository as never, adapter as never, {
      query: '发票',
      projectId: 'workspace-without-records',
      scope: MemoryScope.Personal,
    }),
  ).resolves.toEqual([]);
  expect(adapter.recent).not.toHaveBeenCalled();
});

test('does not swallow other runtime failures as empty recall results', async () => {
  const adapter = {
    recall: vi.fn(async () => {
      throw new EngramRequestError(500, 'GET', '/search', 'internal_error', 'boom');
    }),
    recent: vi.fn(),
  };
  const repository = { getRecallMetadata: vi.fn(() => new Map()) };

  await expect(
    recallMemoryScope(repository as never, adapter as never, {
      query: '发票',
      projectId: 'workspace-a',
      scope: MemoryScope.Project,
    }),
  ).rejects.toThrow('HTTP 500');
});
