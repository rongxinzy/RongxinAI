import { expect, test, vi } from 'vitest';

import { MemoryRepository } from './repository';

test('creates the link and outbox schema without importing the memory kernel database', () => {
  const exec = vi.fn();

  new MemoryRepository({ exec } as never);

  const schema = exec.mock.calls[0][0] as string;
  expect(schema).toContain('CREATE TABLE IF NOT EXISTS memory_links');
  expect(schema).toContain('CREATE TABLE IF NOT EXISTS memory_outbox');
  expect(schema).toContain('CREATE TABLE IF NOT EXISTS memory_candidates');
  expect(schema).toContain('superseded_by TEXT');
  expect(schema).toContain('sensitivity TEXT');
  expect(schema).toContain('idx_memory_outbox_pending');
});
