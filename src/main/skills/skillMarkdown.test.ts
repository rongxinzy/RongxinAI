import { afterEach, expect, test, vi } from 'vitest';

import {
  compareVersions,
  isZipFile,
  normalizeFolderName,
  parseFrontmatter,
  resolveWithin,
} from './skillMarkdown';

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

const createMergeFrontmatter = (sources: number, targets: number): string =>
  [
    '---',
    'name: merge-test',
    `sources: &sources [${Array.from({ length: sources }, () => '{}').join(',')}]`,
    'targets:',
    ...Array.from({ length: targets }, () => '  - <<: *sources'),
    '---',
    '# Body',
    '',
  ].join('\n');

afterEach(() => {
  vi.restoreAllMocks();
});

test('parseFrontmatter preserves merge input within the parser work budget', () => {
  const { frontmatter, content } = parseFrontmatter(createMergeFrontmatter(100, 100));
  expect(frontmatter.name).toBe('merge-test');
  expect(frontmatter.targets).toHaveLength(100);
  expect(content).toBe('# Body\n');
});

test('parseFrontmatter rejects empty merge sources beyond the parser work budget', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const parsed = parseFrontmatter(createMergeFrontmatter(50, 201));

  expect(parsed).toEqual({ frontmatter: {}, content: '# Body\n' });
  expect(warn).toHaveBeenCalledWith(
    '[skills] Failed to parse YAML frontmatter:',
    expect.objectContaining({ reason: 'merge keys exceeded maxTotalMergeKeys (10000)' }),
  );
});

test('parseFrontmatter rejects oversized merge sequences while preserving content', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const parsed = parseFrontmatter(createMergeFrontmatter(101, 1));

  expect(parsed).toEqual({ frontmatter: {}, content: '# Body\n' });
  expect(warn).toHaveBeenCalledWith(
    '[skills] Failed to parse YAML frontmatter:',
    expect.objectContaining({ reason: 'abnormal merge sequence size' }),
  );
});

test('parseFrontmatter preserves ordered-map entries and rejects duplicate keys', () => {
  const raw =
    '---\nname: ordered\nmetadata: !!omap\n  - first: one\n  - second: two\n---\n# Body\n';
  expect(parseFrontmatter(raw).frontmatter.metadata).toEqual([{ first: 'one' }, { second: 'two' }]);

  vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(parseFrontmatter(raw.replace('second:', 'first:'))).toEqual({
    frontmatter: {},
    content: '# Body\n',
  });
});
