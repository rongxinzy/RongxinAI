import { expect, test } from 'vitest';

import { compareVersions, isZipFile, normalizeFolderName, resolveWithin } from './skillMarkdown';

test('compareVersions: orders numeric segments', () => {
  expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
  expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
  expect(compareVersions('2.0', '1.9.9')).toBe(1);
  expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
});

test('compareVersions: treats missing and non-numeric segments as 0', () => {
  expect(compareVersions('1.0', '1.0.0')).toBe(0);
  expect(compareVersions('1.0.x', '1.0.0')).toBe(0);
});

test('normalizeFolderName: sanitizes to a safe folder name', () => {
  expect(normalizeFolderName('web-search')).toBe('web-search');
  expect(normalizeFolderName('Web Search!')).toBe('Web-Search');
  expect(normalizeFolderName('..git..')).toBe('git');
  expect(normalizeFolderName('///')).toBe('skill');
});

test('isZipFile matches the .zip extension case-insensitively', () => {
  expect(isZipFile('/tmp/skill.ZIP')).toBe(true);
  expect(isZipFile('/tmp/skill.zip')).toBe(true);
  expect(isZipFile('/tmp/skill.tgz')).toBe(false);
});

test('resolveWithin resolves targets under the root', () => {
  expect(resolveWithin('/root', 'child')).toBe('/root/child');
  expect(resolveWithin('/root', '/root/abs')).toBe('/root/abs');
  expect(resolveWithin('/root', '/root')).toBe('/root');
});

test('resolveWithin rejects targets escaping the root', () => {
  expect(() => resolveWithin('/root', '../outside')).toThrow('Invalid target path');
  expect(() => resolveWithin('/root', '/etc/passwd')).toThrow('Invalid target path');
});
