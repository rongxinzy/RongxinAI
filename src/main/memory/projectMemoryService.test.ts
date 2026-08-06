import { expect, test, vi } from 'vitest';

import {
  EngramMemoryScope,
  EngramObservationType,
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
