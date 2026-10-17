/**
 * Unit tests for the parsing/normalization helpers split out of
 * coworkStore.ts (issue #1069). Pure functions, no database required.
 */
import { expect, test } from 'vitest';

import { CoworkPermissionMode } from '../../shared/cowork/constants';
import {
  extractConversationSearchTerms,
  normalizeMessageTimestamp,
  normalizePermissionMode,
  parseBooleanConfig,
  parseEmbeddingVectorWeight,
  parseTimeToMs,
  truncate,
} from './helpers';

test('parseBooleanConfig accepts common boolean spellings and falls back otherwise', () => {
  for (const truthy of ['1', 'true', 'TRUE', 'Yes', 'on']) {
    expect(parseBooleanConfig(truthy, false)).toBe(true);
  }
  for (const falsy of ['0', 'false', 'No', 'OFF']) {
    expect(parseBooleanConfig(falsy, true)).toBe(false);
  }
  expect(parseBooleanConfig(undefined, true)).toBe(true);
  expect(parseBooleanConfig('', false)).toBe(false);
  expect(parseBooleanConfig('garbage', true)).toBe(true);
  expect(parseBooleanConfig('garbage', false)).toBe(false);
});

test('normalizePermissionMode keeps known modes and defaults to allow-all', () => {
  expect(normalizePermissionMode(CoworkPermissionMode.Ask)).toBe(CoworkPermissionMode.Ask);
  expect(normalizePermissionMode(CoworkPermissionMode.AllowAll)).toBe(
    CoworkPermissionMode.AllowAll,
  );
  expect(normalizePermissionMode(undefined)).toBe(CoworkPermissionMode.AllowAll);
  expect(normalizePermissionMode('nonsense')).toBe(CoworkPermissionMode.AllowAll);
});

test('parseEmbeddingVectorWeight clamps to [0, 1] and defaults to 0.7', () => {
  expect(parseEmbeddingVectorWeight(undefined)).toBe(0.7);
  expect(parseEmbeddingVectorWeight('')).toBe(0.7);
  expect(parseEmbeddingVectorWeight('not-a-number')).toBe(0.7);
  expect(parseEmbeddingVectorWeight('1.5')).toBe(1);
  expect(parseEmbeddingVectorWeight('-0.5')).toBe(0);
  expect(parseEmbeddingVectorWeight('0.25')).toBe(0.25);
});

test('extractConversationSearchTerms keeps the phrase plus tokens, skipping noise', () => {
  expect(extractConversationSearchTerms('')).toEqual([]);
  expect(extractConversationSearchTerms('   ')).toEqual([]);

  expect(extractConversationSearchTerms('hello world')).toEqual(['hello world', 'hello', 'world']);

  // Single ASCII alphanumerics are dropped.
  expect(extractConversationSearchTerms('a b cc')).toEqual(['a b cc', 'cc']);

  // Duplicates collapse.
  expect(extractConversationSearchTerms('go go go')).toEqual(['go go go', 'go']);

  // Common separators split tokens.
  expect(extractConversationSearchTerms('foo,bar、baz/qux')).toEqual([
    'foo,bar、baz/qux',
    'foo',
    'bar',
    'baz',
    'qux',
  ]);
});

test('extractConversationSearchTerms caps the term list at 8', () => {
  const terms = extractConversationSearchTerms('one two three four five six seven eight nine ten');
  expect(terms).toHaveLength(8);
  expect(terms[0]).toBe('one two three four five six seven eight nine ten');
  expect(terms.slice(1)).toEqual(['one', 'two', 'three', 'four', 'five', 'six', 'seven']);
});

test('truncate keeps short strings and appends an ellipsis beyond the limit', () => {
  expect(truncate('abcdef', 6)).toBe('abcdef');
  expect(truncate('abcdefg', 6)).toBe('abcde…');
  expect(truncate('', 3)).toBe('');
});

test('parseTimeToMs returns epoch millis for valid dates and null otherwise', () => {
  expect(parseTimeToMs(undefined)).toBeNull();
  expect(parseTimeToMs(null)).toBeNull();
  expect(parseTimeToMs('')).toBeNull();
  expect(parseTimeToMs('not a date')).toBeNull();
  expect(parseTimeToMs('2024-01-02T03:04:05.000Z')).toBe(
    new Date('2024-01-02T03:04:05.000Z').getTime(),
  );
});

test('normalizeMessageTimestamp only accepts finite positive numbers', () => {
  expect(normalizeMessageTimestamp(123.5)).toBe(123.5);
  expect(normalizeMessageTimestamp(0)).toBeNull();
  expect(normalizeMessageTimestamp(-1)).toBeNull();
  expect(normalizeMessageTimestamp(Number.NaN)).toBeNull();
  expect(normalizeMessageTimestamp(Number.POSITIVE_INFINITY)).toBeNull();
  expect(normalizeMessageTimestamp('1700000000000')).toBeNull();
  expect(normalizeMessageTimestamp(null)).toBeNull();
});
