import { expect, test, vi } from 'vitest';

import {
  EngramMemoryScope,
  EngramObservationType,
  EngramSearchMatchMode,
  MemoryOutboxOperation,
  MemoryOutboxStatus,
} from './constants';
import type { ProjectIdentity } from './projectIdentity';
import { ProjectMemoryService } from './projectMemoryService';
import type { MemoryOutboxItem } from './repository';

class FakeRepository {
  items: MemoryOutboxItem[] = [];
  links: Array<Record<string, unknown>> = [];

  enqueue(operation: typeof MemoryOutboxOperation.Confirm, payload: Record<string, unknown>) {
    const id = `outbox-${this.items.length + 1}`;
    this.items.push({
      id,
      operation,
      payload,
      status: MemoryOutboxStatus.Pending,
      attempts: 0,
      availableAt: new Date(0).toISOString(),
      lastError: null,
    });
    return id;
  }

  listPending() {
    return this.items.filter(item => item.status === MemoryOutboxStatus.Pending);
  }

  filterRecallableMemoryIds(_projectId: string, memoryIds: number[]) {
    return new Set(memoryIds);
  }

  listManaged() {
    return [];
  }

  getRecallMetadata() {
    return new Map();
  }

  createLink(input: Record<string, unknown>) {
    this.links.push(input);
    return String(input.id);
  }

  markCompleted(id: string) {
    const item = this.items.find(candidate => candidate.id === id);
    if (item) item.status = MemoryOutboxStatus.Completed;
  }

  markRetry(id: string, attempts: number, error: string) {
    const item = this.items.find(candidate => candidate.id === id);
    if (item) {
      item.attempts = attempts;
      item.lastError = error;
    }
  }
}

function identityFor(cwd: string): ProjectIdentity {
  return {
    id: `project-${cwd}`,
    displayName: cwd,
    root: `/workspace/${cwd}`,
    canonicalSource: `path:${cwd}`,
  };
}

test('always recalls with the current project identity', async () => {
  const recall = vi.fn(async () => []);
  const service = new ProjectMemoryService(
    new FakeRepository() as never,
    { recall } as never,
    identityFor,
  );

  await service.recallProject({ workingDirectory: 'alpha', query: 'database' });
  await service.recallProject({ workingDirectory: 'beta', query: 'database' });

  expect(recall.mock.calls[0][0]).toMatchObject({
    project: 'project-alpha',
    scope: EngramMemoryScope.Project,
  });
  expect(recall.mock.calls[1][0]).toMatchObject({ project: 'project-beta' });
});

test('persists the outbox before confirming and linking a project memory', async () => {
  const repository = new FakeRepository();
  const adapter = {
    saveCandidate: vi.fn(input => ({ id: 'candidate-1', ...input })),
    confirmMemory: vi.fn(async () => 42),
    discardCandidate: vi.fn(),
  };
  const service = new ProjectMemoryService(repository as never, adapter as never, identityFor);

  await expect(
    service.saveProjectMemory({
      sessionId: 'session-1',
      workingDirectory: 'alpha',
      type: EngramObservationType.Decision,
      title: 'Database',
      content: 'Use SQLite.',
    }),
  ).resolves.toBe(42);

  expect(repository.items[0]).toMatchObject({ status: MemoryOutboxStatus.Completed });
  expect(repository.links[0]).toMatchObject({
    memoryId: 42,
    projectId: 'project-alpha',
    sessionId: 'session-1',
  });
});

test('keeps an unavailable write pending for a later outbox drain', async () => {
  const repository = new FakeRepository();
  const adapter = {
    saveCandidate: vi.fn(input => ({ id: 'candidate-1', ...input })),
    confirmMemory: vi.fn(async () => null),
    discardCandidate: vi.fn(),
  };
  const service = new ProjectMemoryService(repository as never, adapter as never, identityFor);

  await service.saveProjectMemory({
    sessionId: 'session-1',
    workingDirectory: 'alpha',
    type: EngramObservationType.Decision,
    title: 'Database',
    content: 'Use SQLite.',
  });

  expect(repository.items[0]).toMatchObject({
    status: MemoryOutboxStatus.Pending,
    attempts: 1,
    lastError: 'Memory runtime unavailable.',
  });
  expect(adapter.discardCandidate).toHaveBeenCalledWith('candidate-1');
  expect(repository.links).toHaveLength(0);
});

test('enforces the project context token budget', async () => {
  const adapter = {
    recall: vi.fn(async (input: { scope: string }) =>
      input.scope === EngramMemoryScope.Personal
        ? []
        : [
            { id: 1, title: 'First', content: 'A'.repeat(40) },
            { id: 2, title: 'Second', content: 'B'.repeat(400) },
          ],
    ),
  };
  const service = new ProjectMemoryService(
    new FakeRepository() as never,
    adapter as never,
    identityFor,
  );

  const context = await service.buildProjectContext({
    workingDirectory: 'alpha',
    query: 'database',
    tokenBudget: 30,
  });

  expect(context).toContain('[memory:1]');
  expect(context).not.toContain('[memory:2]');
});

test('broadens an empty CJK search with any-match terms', async () => {
  const recall = vi.fn(async (input: { matchMode: string }) =>
    input.matchMode === EngramSearchMatchMode.Any
      ? [
          {
            id: 9,
            title: 'Project database',
            content: 'Use SQLite.',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ]
      : [],
  );
  const service = new ProjectMemoryService(
    new FakeRepository() as never,
    { recall, recent: vi.fn(async () => []) } as never,
    identityFor,
  );

  await expect(
    service.recallProject({ workingDirectory: 'alpha', query: '我们项目使用什么数据库' }),
  ).resolves.toMatchObject([{ id: 9 }]);
  expect(recall).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ matchMode: EngramSearchMatchMode.Any }),
  );
});

test('falls back to bounded recent active memory only for explicit memory intent', async () => {
  const recent = vi.fn(async () => [
    {
      id: 10,
      title: 'Current project',
      content: 'The project is ZhiYuan.',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ]);
  const service = new ProjectMemoryService(
    new FakeRepository() as never,
    { recall: vi.fn(async () => []), recent } as never,
    identityFor,
  );

  await expect(
    service.recallProject({ workingDirectory: 'alpha', query: '当前项目是什么' }),
  ).resolves.toMatchObject([{ id: 10 }]);
  expect(recent).toHaveBeenCalledWith({
    project: 'project-alpha',
    scope: EngramMemoryScope.Project,
    limit: 8,
  });
});

test('lists only the current project and confirmed personal memories', () => {
  const memories = [
    { id: 'project-current', projectId: 'project-alpha', scope: EngramMemoryScope.Project },
    { id: 'project-other', projectId: 'project-beta', scope: EngramMemoryScope.Project },
    {
      id: 'personal',
      projectId: 'personal://zhiyuan-agent/user',
      scope: EngramMemoryScope.Personal,
    },
    { id: 'session', projectId: 'project-alpha', scope: EngramMemoryScope.Session },
  ];
  const service = new ProjectMemoryService(
    { listManaged: vi.fn(() => memories) } as never,
    {} as never,
    identityFor,
  );

  expect(
    service.listRecallableMemories({ workingDirectory: 'alpha' }).map(memory => memory.id),
  ).toEqual(['project-current', 'personal']);
});
