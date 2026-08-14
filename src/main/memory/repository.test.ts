import { expect, test, vi } from 'vitest';

import { MemoryLifecycleStatus, MemoryScope } from '../../shared/memory';
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

test('authorizes recall by projected scope and current session', () => {
  const all = vi.fn(() => [{ memory_id: 17 }]);
  const prepare = vi.fn((sql: string) => {
    if (sql.includes('SELECT memory_id')) return { all };
    if (sql.includes('PRAGMA table_info')) return { all: vi.fn(() => []) };
    return { run: vi.fn() };
  });
  const repository = new MemoryRepository({ exec: vi.fn(), prepare } as never);

  expect(
    repository.filterRecallableMemoryIds({
      projectId: 'project-a',
      memoryIds: [16, 17],
      scope: MemoryScope.Session,
      sessionId: 'session-a',
    }),
  ).toEqual(new Set([17]));

  const recallSql = prepare.mock.calls.find(([sql]) => String(sql).includes('SELECT memory_id'))?.[0];
  expect(recallSql).toContain('scope = ?');
  expect(recallSql).toContain('session_id = ?');
  expect(all).toHaveBeenCalledWith(
    'project-a',
    MemoryLifecycleStatus.Active,
    MemoryScope.Session,
    16,
    17,
    'session-a',
  );
});

test('rejects session recall without a current session id', () => {
  const prepare = vi.fn((sql: string) => ({
    run: vi.fn(),
    all: vi.fn(() => (sql.includes('PRAGMA table_info') ? [] : undefined)),
  }));
  const repository = new MemoryRepository({ exec: vi.fn(), prepare } as never);

  expect(
    repository.filterRecallableMemoryIds({
      projectId: 'project-a',
      memoryIds: [17],
      scope: MemoryScope.Session,
    }),
  ).toEqual(new Set());
});
