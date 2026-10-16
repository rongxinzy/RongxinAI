export interface CellData {
  v: string;
  bgColor?: string;
  fontColor?: string;
  bold?: boolean;
  colSpan?: number;
  hidden?: boolean;
}

export interface MergeRange {
  sr: number;
  sc: number;
  er: number;
  ec: number;
}

export interface SheetData {
  name: string;
  rows: CellData[][];
  colCount: number;
}

export function isCsvOrTsv(fileName: string): boolean {
  const ext = fileName.toLowerCase();
  return ext.endsWith('.csv') || ext.endsWith('.tsv') || ext.endsWith('.txt');
}

export function applyMerges(rows: CellData[][], merges: MergeRange[]) {
  for (const m of merges) {
    if (rows[m.sr] && rows[m.sr][m.sc]) {
      rows[m.sr][m.sc].colSpan = m.ec - m.sc + 1;
    }
    for (let r = m.sr; r <= m.er; r++) {
      for (let c = m.sc; c <= m.ec; c++) {
        if (r === m.sr && c === m.sc) continue;
        if (rows[r] && rows[r][c]) {
          rows[r][c].hidden = true;
        }
      }
    }
  }
}
