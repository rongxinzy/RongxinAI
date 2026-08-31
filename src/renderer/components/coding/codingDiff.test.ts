import { describe, expect, test } from 'vitest';

import {
  buildLineDiffRows,
  collapseContextRows,
  CodingDiffRowType,
  type CodingDiffRow,
} from './codingDiff';

const types = (rows: CodingDiffRow[]) => rows.map(row => row.type);

describe('buildLineDiffRows', () => {
  test('marks every line as added when the file is new', () => {
    expect(buildLineDiffRows('', 'a\nb')).toEqual([
      { type: CodingDiffRowType.Add, text: 'a' },
      { type: CodingDiffRowType.Add, text: 'b' },
    ]);
  });

  test('marks every line as deleted when the file is removed', () => {
    expect(buildLineDiffRows('a\nb', '')).toEqual([
      { type: CodingDiffRowType.Del, text: 'a' },
      { type: CodingDiffRowType.Del, text: 'b' },
    ]);
  });

  test('keeps identical lines as context around a change', () => {
    const rows = buildLineDiffRows('a\nb\nc', 'a\nB\nc');
    expect(rows).toEqual([
      { type: CodingDiffRowType.Context, text: 'a' },
      { type: CodingDiffRowType.Del, text: 'b' },
      { type: CodingDiffRowType.Add, text: 'B' },
      { type: CodingDiffRowType.Context, text: 'c' },
    ]);
  });

  test('diffs a multi-line insertion against unchanged context', () => {
    const rows = buildLineDiffRows('start\nend', 'start\nx\ny\nend');
    expect(types(rows)).toEqual([
      CodingDiffRowType.Context,
      CodingDiffRowType.Add,
      CodingDiffRowType.Add,
      CodingDiffRowType.Context,
    ]);
  });

  test('falls back to a whole-file replacement beyond the LCS cell cap', () => {
    const oldText = Array.from({ length: 1500 }, (_, index) => `old-${index}`).join('\n');
    const newText = Array.from({ length: 1500 }, (_, index) => `new-${index}`).join('\n');
    const rows = buildLineDiffRows(oldText, newText);
    expect(rows).toHaveLength(3000);
    expect(rows[0]).toEqual({ type: CodingDiffRowType.Del, text: 'old-0' });
    expect(rows[1500]).toEqual({ type: CodingDiffRowType.Add, text: 'new-0' });
  });
});

describe('collapseContextRows', () => {
  test('returns rows untouched when there are no changes', () => {
    const rows = buildLineDiffRows('a\nb', 'a\nb');
    expect(collapseContextRows(rows)).toEqual(rows);
  });

  test('folds long context runs into a gap marker', () => {
    const oldText = Array.from({ length: 30 }, (_, index) => `line-${index}`).join('\n');
    const newText = oldText.replace('line-15', 'changed');
    const collapsed = collapseContextRows(buildLineDiffRows(oldText, newText), 3);
    const gaps = collapsed.filter(row => row.type === 'gap');
    expect(gaps).toEqual([
      { type: 'gap', count: 12 },
      { type: 'gap', count: 11 },
    ]);
    expect(collapsed.filter(row => row.type !== 'gap')).toHaveLength(8);
  });
});
