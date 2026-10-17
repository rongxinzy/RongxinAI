import { describe, expect, test } from 'vitest';

import { parseDiff } from './diff';

describe('parseDiff', () => {
  test('parses a unified diff with hunk headers, stripping file headers', () => {
    const raw = [
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,3 +1,3 @@',
      ' const a = 1;',
      '-old line',
      '+new line',
    ].join('\n');

    expect(parseDiff(raw)).toEqual({
      original: 'const a = 1;\nold line',
      modified: 'const a = 1;\nnew line',
    });
  });

  test('treats marker-less lines as context on both sides', () => {
    const raw = ['- a', '+ b', ' plain', 'plain-no-space', '- c', '+ d'].join('\n');

    expect(parseDiff(raw)).toEqual({
      original: ' a\nplain\nplain-no-space\n c',
      modified: ' b\nplain\nplain-no-space\n d',
    });
  });

  test('parses headerless diffs when marker lines dominate (ratio >= 60%)', () => {
    const raw = [' ctx', '- old', '+ new'].join('\n');

    // slice(1) removes only the marker char, so the space after '-' is kept.
    expect(parseDiff(raw)).toEqual({ original: 'ctx\n old', modified: 'ctx\n new' });
  });

  test('rejects headerless diffs when marker ratio is below 60%', () => {
    const raw = ['intro line', '- del', '+ add', 'plain line', 'another plain line'].join('\n');

    expect(parseDiff(raw)).toBeNull();
  });

  test('rejects content with only deletions and no hunk header', () => {
    expect(parseDiff('- only deletions\n- another')).toBeNull();
  });

  test('rejects content with only additions and no hunk header', () => {
    expect(parseDiff('+ only additions')).toBeNull();
  });

  test('rejects plain prose without any diff markers', () => {
    expect(parseDiff('just some text\nwith no markers')).toBeNull();
  });

  test('rejects empty content', () => {
    expect(parseDiff('')).toBeNull();
  });

  test('parses a lone hunk header into empty sides', () => {
    expect(parseDiff('@@ -1 +1 @@')).toEqual({ original: '', modified: '' });
  });

  test('hunk header content skips the marker-ratio heuristic', () => {
    // Only one deletion and lots of context — still parsed because @@ is present.
    const raw = ['@@ -1,4 +1,4 @@', ' a', ' b', ' c', '- d'].join('\n');

    expect(parseDiff(raw)).toEqual({ original: 'a\nb\nc\n d', modified: 'a\nb\nc' });
  });
});
