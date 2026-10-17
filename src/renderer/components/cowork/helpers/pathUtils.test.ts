import { describe, expect, test } from 'vitest';

import { resolveLocalFilePath } from './pathUtils';

describe('resolveLocalFilePath', () => {
  test('resolves root-relative file hrefs directly', () => {
    expect(resolveLocalFilePath('file:///root/path::relative/file.txt', 'unused')).toBe(
      '/root/path/relative/file.txt',
    );
  });

  test('resolves relative hrefs against the session cwd', () => {
    expect(resolveLocalFilePath('./docs/a.md', 'docs/a.md', '/work/proj')).toBe(
      '/work/proj/docs/a.md',
    );
    expect(resolveLocalFilePath('notes/today.md', 'anything', '/work/proj/')).toBe(
      '/work/proj/notes/today.md',
    );
  });

  test('keeps absolute hrefs as-is', () => {
    expect(resolveLocalFilePath('/abs/path/x.md', 'x.md', '/work')).toBe('/abs/path/x.md');
    expect(resolveLocalFilePath('C:\\Users\\me\\x.md', 'x.md', '/work')).toBe(
      'C:\\Users\\me\\x.md',
    );
  });

  test('falls back to the link text when the href is not a local path', () => {
    expect(resolveLocalFilePath('https://example.com/a', 'reports/q3.md', '/work')).toBe(
      '/work/reports/q3.md',
    );
    expect(resolveLocalFilePath('', './local/file.txt', '/work')).toBe('/work/local/file.txt');
  });

  test('root-relative text still wins over non-local hrefs', () => {
    expect(
      resolveLocalFilePath('https://example.com/a', 'file:///root::sub/file.txt', '/work'),
    ).toBe('/root/sub/file.txt');
  });

  test('returns null when neither side resolves to a local path', () => {
    expect(resolveLocalFilePath('', '')).toBeNull();
    expect(resolveLocalFilePath('https://example.com/a', 'https://example.com/b')).toBeNull();
    expect(resolveLocalFilePath('./rel/a.md', 'rel/a.md')).toBeNull();
  });
});
