import { expect, test } from 'vitest';

import { applyMerges, isCsvOrTsv, type CellData } from './xlsxSheetModel';

test('isCsvOrTsv matches csv, tsv and txt names case-insensitively', () => {
  expect(isCsvOrTsv('data.CSV')).toBe(true);
  expect(isCsvOrTsv('export.tsv')).toBe(true);
  expect(isCsvOrTsv('notes.txt')).toBe(true);
  expect(isCsvOrTsv('report.xlsx')).toBe(false);
  expect(isCsvOrTsv('data.csv.bak')).toBe(false);
});

test('applyMerges widens the anchor cell and hides only covered cells', () => {
  const rows: CellData[][] = [
    [{ v: 'A1' }, { v: 'B1' }, { v: 'C1' }],
    [{ v: 'A2' }, { v: 'B2' }, { v: 'C2' }],
  ];

  applyMerges(rows, [{ sr: 0, sc: 0, er: 0, ec: 1 }]);

  expect(rows[0][0].colSpan).toBe(2);
  expect(rows[0][0].hidden).toBeUndefined();
  expect(rows[0][1].hidden).toBe(true);
  expect(rows[0][2].hidden).toBeUndefined();
  expect(rows[1][0].hidden).toBeUndefined();
  expect(rows[1][1].hidden).toBeUndefined();
});

test('applyMerges handles multi-row merges', () => {
  const rows: CellData[][] = [
    [{ v: 'A1' }, { v: 'B1' }],
    [{ v: 'A2' }, { v: 'B2' }],
  ];

  applyMerges(rows, [{ sr: 0, sc: 1, er: 1, ec: 1 }]);

  expect(rows[0][1].colSpan).toBe(1);
  expect(rows[0][1].hidden).toBeUndefined();
  expect(rows[1][1].hidden).toBe(true);
  expect(rows[1][0].hidden).toBeUndefined();
});

test('applyMerges ignores ranges that fall outside the sheet', () => {
  const rows: CellData[][] = [[{ v: 'A1' }]];

  applyMerges(rows, [
    { sr: 5, sc: 5, er: 6, ec: 6 },
    { sr: 0, sc: 9, er: 0, ec: 10 },
  ]);

  expect(rows[0][0].colSpan).toBeUndefined();
  expect(rows[0][0].hidden).toBeUndefined();
});
