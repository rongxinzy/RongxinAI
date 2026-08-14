import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import {
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySourceKind,
} from '../../shared/memory';
import { MemoryRepository } from './repository';

test('creates the link and outbox schema without importing the memory kernel database', () => {
  const exec = vi.fn();

  new MemoryRepository({ exec } as never);

  const schema = exec.mock.calls[0][0] as string;
  expect(schema).toContain('CREATE TABLE IF NOT EXISTS memory_links');
  expect(schema).toContain('CREATE TABLE IF NOT EXISTS memory_outbox');
  expect(schema).toContain('CREATE TABLE IF NOT EXISTS memory_candidates');
  expect(schema).toContain('project_root TEXT');
  expect(schema).toContain("scope TEXT NOT NULL DEFAULT 'personal'");
  expect(schema).toContain('superseded_by TEXT');
  expect(schema).toContain('sensitivity TEXT');
  expect(schema).toContain('idx_memory_outbox_pending');
});

test('authorizes recall against projected scope, session, and lifecycle state', () => {
  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);
  const createLink = (
    memoryId: number,
    scope: MemoryScope,
    sessionId: string,
    expiresAt?: string,
  ) =>
    repository.createLink({
      id: `link-${memoryId}`,
      memoryId,
      projectId: 'project-a',
      scope,
      sessionId,
      sourceKind:
        scope === MemoryScope.Session ? MemorySourceKind.SessionSummary : MemorySourceKind.Explicit,
      title: `Memory ${memoryId}`,
      content: `Content ${memoryId}`,
      kind: scope === MemoryScope.Session ? MemoryKind.SessionSummary : MemoryKind.Decision,
      expiresAt,
    });

  try {
    createLink(1, MemoryScope.Project, 'session-origin');
    createLink(2, MemoryScope.Session, 'session-a');
    createLink(3, MemoryScope.Session, 'session-b');
    const archivedLinkId = createLink(4, MemoryScope.Project, 'session-origin');
    createLink(5, MemoryScope.Project, 'session-origin', '2000-01-01T00:00:00.000Z');
    repository.setLinkStatus(archivedLinkId, MemoryLifecycleStatus.Archived);
    const memoryIds = [1, 2, 3, 4, 5];

    expect(
      repository.filterRecallableMemoryIds({
        projectId: 'project-a',
        memoryIds,
        scope: MemoryScope.Project,
      }),
    ).toEqual(new Set([1]));
    expect(
      repository.filterRecallableMemoryIds({
        projectId: 'project-a',
        memoryIds,
        scope: MemoryScope.Session,
        sessionId: 'session-a',
      }),
    ).toEqual(new Set([2]));
    expect(
      repository.filterRecallableMemoryIds({
        projectId: 'project-a',
        memoryIds,
        scope: MemoryScope.Session,
        sessionId: 'session-b',
      }),
    ).toEqual(new Set([3]));
    expect(
      repository.filterRecallableMemoryIds({
        projectId: 'project-a',
        memoryIds,
        scope: MemoryScope.Session,
      }),
    ).toEqual(new Set());
  } finally {
    db.close();
  }
});
