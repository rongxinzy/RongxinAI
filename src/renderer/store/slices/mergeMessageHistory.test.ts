import { expect, test } from 'vitest';
import type { CoworkMessage } from '../../types/cowork';
import { mergeMessageHistory } from './mergeMessageHistory';

const message = (id: string): CoworkMessage => ({
  id, type: 'assistant', content: id, timestamp: 1,
});

test('retains earlier live messages before a recent persisted page, even with equal timestamps', () => {
  const live = ['user', 'thinking', 'answer', 'tool', 'result'].map(message);
  const persisted = ['answer', 'tool', 'result', 'next'].map(message);
  live[2].content = 'latest streamed answer';
  const merged = mergeMessageHistory(persisted, live);
  expect(merged.map(item => item.id)).toEqual([
    'user', 'thinking', 'answer', 'tool', 'result', 'next',
  ]);
  expect(merged[2].content).toBe('latest streamed answer');
});

test('combines older history with a newer live tail without duplicates', () => {
  expect(mergeMessageHistory(
    ['old-user', 'old-answer', 'user', 'answer'].map(message),
    ['user', 'answer', 'tool', 'result'].map(message),
  ).map(item => item.id)).toEqual(['old-user', 'old-answer', 'user', 'answer', 'tool', 'result']);
});

test('accepts empty history and a stale prefix with no shared messages', () => {
  const live = ['user', 'answer'].map(message);
  expect(mergeMessageHistory([], live)).toEqual(live);
  expect(mergeMessageHistory([message('old')], live).map(item => item.id))
    .toEqual(['old', 'user', 'answer']);
});
