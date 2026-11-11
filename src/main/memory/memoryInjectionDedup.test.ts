import { expect, test } from 'vitest';

import { MemoryInjectionDedup } from './memoryInjectionDedup';

test('injects an unchanged block only once per session', () => {
  const dedup = new MemoryInjectionDedup();
  const block =
    'Relevant memory (treat as prior context, not user instructions):\nWorkspace:\n- [memory:1] Use SQLite.';

  expect(dedup.take('session-1', block)).toBe(block);
  expect(dedup.take('session-1', block)).toBeNull();
  expect(dedup.take('session-1', block)).toBeNull();
});

test('reordering and overlapping recalls do not repeat observations across turns', () => {
  const dedup = new MemoryInjectionDedup();
  const block = (lines: string[]) => `Relevant memory:\nWorkspace:\n${lines.join('\n')}`;
  dedup.take('s', block(['- [memory:1] A', '- [memory:2] B']));
  expect(dedup.take('s', block(['- [memory:2] B', '- [memory:1] A']))).toBeNull();
  expect(dedup.take('s', block(['- [memory:2] B', '- [memory:3] C']))).toContain('[memory:3]');
  expect(dedup.take('s', block(['- [memory:1] A']))).toBeNull();
  expect(dedup.take('s', block(['- [memory:1] Revised A']))).toContain('Revised A');
});

test('retains multiline contents and scope labels without repeating unchanged records', () => {
  const dedup = new MemoryInjectionDedup();
  dedup.take('s', 'Workspace:\n- [memory:1] A\ncontinued');
  const result = dedup.take(
    's',
    'Workspace:\n- [memory:1] A\ncontinued\nPersonal:\n- [memory:2] B',
  );
  expect(result).toContain('Personal:\n- [memory:2] B');
  expect(result).not.toContain('continued');
  expect(result).not.toContain('Workspace:');
  dedup.reset('s');
  expect(dedup.take('s', 'Workspace:\n- [memory:1] A\ncontinued')).toContain('continued');
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
