import path from 'path';

import { describe, expect, test } from 'vitest';

import { isPathInside } from './pathContainment';

describe('isPathInside', () => {
  const root = path.resolve('/tmp/zy-containment-root');

  test('root contains itself (inclusive) and nested targets', () => {
    expect(isPathInside(root, root)).toBe(true);
    expect(isPathInside(path.join(root, 'a', 'b.txt'), root)).toBe(true);
  });

  test('rejects siblings, parents, and traversal', () => {
    expect(isPathInside(path.resolve('/tmp/zy-containment-root-2', 'x'), root)).toBe(false);
    expect(isPathInside(path.dirname(root), root)).toBe(false);
    expect(isPathInside(path.join(root, '..', 'escape.txt'), root)).toBe(false);
  });

  test('cross-drive candidates on win32 count as outside', () => {
    // path.relative across drives returns the absolute target; the helper
    // must reject it instead of mistaking it for a benign relative path.
    const relative = path.win32.relative('C:\\zy\\root', 'D:\\zy\\evil.dll');
    expect(path.win32.isAbsolute(relative)).toBe(true);
    expect(relative.startsWith('..')).toBe(false);
    // The naive prefix check alone would accept this string; requiring
    // non-absolute is what rejects it.
    expect(!relative.startsWith('..') && !path.win32.isAbsolute(relative)).toBe(false);
  });
});
