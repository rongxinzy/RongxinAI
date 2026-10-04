import { expect, test } from 'vitest';

import { MemoryInjectionDedup } from './memoryInjectionDedup';

test('injects an unchanged block only once per session', () => {
  const dedup = new MemoryInjectionDedup();
  const block = 'Relevant memory:\nWorkspace:\n- [memory:1] Use SQLite.';

  expect(dedup.take('session-1', block)).toBe(block);
  expect(dedup.take('session-1', block)).toBeNull();
  expect(dedup.take('session-1', block)).toBeNull();
});

test('injects again when the block content changes', () => {
  const dedup = new MemoryInjectionDedup();

  expect(dedup.take('session-1', 'block A')).toBe('block A');
  expect(dedup.take('session-1', 'block B')).toBe('block B');
  expect(dedup.take('session-1', 'block B')).toBeNull();
});

test('never injects an empty block and keeps the previous fingerprint', () => {
  const dedup = new MemoryInjectionDedup();

  expect(dedup.take('session-1', '')).toBeNull();
  expect(dedup.take('session-1', 'block A')).toBe('block A');
  expect(dedup.take('session-1', '')).toBeNull();
  expect(dedup.take('session-1', 'block A')).toBeNull();
});

test('tracks fingerprints independently per session', () => {
  const dedup = new MemoryInjectionDedup();

  expect(dedup.take('session-1', 'block A')).toBe('block A');
  expect(dedup.take('session-2', 'block A')).toBe('block A');
  expect(dedup.take('session-1', 'block A')).toBeNull();
});

test('reset re-injects the same block on the next turn', () => {
  const dedup = new MemoryInjectionDedup();

  expect(dedup.take('session-1', 'block A')).toBe('block A');
  dedup.reset('session-1');
  expect(dedup.take('session-1', 'block A')).toBe('block A');
  expect(dedup.take('session-1', 'block A')).toBeNull();
});
