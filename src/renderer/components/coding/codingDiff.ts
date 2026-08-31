export const CodingDiffRowType = {
  Add: 'add',
  Del: 'del',
  Context: 'context',
} as const;
export type CodingDiffRowType = (typeof CodingDiffRowType)[keyof typeof CodingDiffRowType];

export interface CodingDiffRow {
  type: CodingDiffRowType;
  text: string;
}

// LCS is O(oldLines × newLines) in both time and memory. Beyond this product a
// whole-file replacement rendering is cheaper and just as truthful.
const MAX_LCS_CELLS = 2_000_000;

const splitLines = (text: string): string[] => (text === '' ? [] : text.split('\n'));

const replaceAll = (oldLines: string[], newLines: string[]): CodingDiffRow[] => [
  ...oldLines.map(text => ({ type: CodingDiffRowType.Del, text })),
  ...newLines.map(text => ({ type: CodingDiffRowType.Add, text })),
];

/**
 * Builds a line-based unified diff (without hunk headers) from the full
 * before/after file contents carried by an ACP `diff` tool-call content item.
 * Lines that are identical on both sides render as context rows.
 */
export const buildLineDiffRows = (oldText: string, newText: string): CodingDiffRow[] => {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  if (oldLines.length === 0) {
    return newLines.map(text => ({ type: CodingDiffRowType.Add, text }));
  }
  if (newLines.length === 0) {
    return oldLines.map(text => ({ type: CodingDiffRowType.Del, text }));
  }
  if (oldLines.length * newLines.length > MAX_LCS_CELLS) {
    return replaceAll(oldLines, newLines);
  }

  const rows = oldLines.length + 1;
  const columns = newLines.length + 1;
  // lengths[i][j] = LCS length of oldLines[i:] and newLines[j:], stored flat.
  const lengths = new Uint32Array(rows * columns);
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      lengths[i * columns + j] =
        oldLines[i] === newLines[j]
          ? lengths[(i + 1) * columns + j + 1] + 1
          : Math.max(lengths[(i + 1) * columns + j], lengths[i * columns + j + 1]);
    }
  }

  const result: CodingDiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: CodingDiffRowType.Context, text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * columns + j] >= lengths[i * columns + j + 1]) {
      result.push({ type: CodingDiffRowType.Del, text: oldLines[i] });
      i += 1;
    } else {
      result.push({ type: CodingDiffRowType.Add, text: newLines[j] });
      j += 1;
    }
  }
  while (i < oldLines.length) {
    result.push({ type: CodingDiffRowType.Del, text: oldLines[i] });
    i += 1;
  }
  while (j < newLines.length) {
    result.push({ type: CodingDiffRowType.Add, text: newLines[j] });
    j += 1;
  }
  return result;
};

/**
 * Collapses long runs of context rows so large files stay readable: at most
 * `edge` context rows are kept around each change, the rest fold into a gap
 * marker row.
 */
export const collapseContextRows = (
  rows: CodingDiffRow[],
  edge = 3,
): (CodingDiffRow | { type: 'gap'; count: number })[] => {
  const changedIndexes = rows.flatMap((row, index) =>
    row.type === CodingDiffRowType.Context ? [] : [index],
  );
  if (changedIndexes.length === 0) return rows;
  const keep = new Set<number>();
  for (const index of changedIndexes) {
    for (let offset = -edge; offset <= edge; offset += 1) {
      const candidate = index + offset;
      if (candidate >= 0 && candidate < rows.length) keep.add(candidate);
    }
  }
  const collapsed: (CodingDiffRow | { type: 'gap'; count: number })[] = [];
  let hidden = 0;
  rows.forEach((row, index) => {
    if (keep.has(index)) {
      if (hidden > 0) {
        collapsed.push({ type: 'gap', count: hidden });
        hidden = 0;
      }
      collapsed.push(row);
    } else {
      hidden += 1;
    }
  });
  if (hidden > 0) collapsed.push({ type: 'gap', count: hidden });
  return collapsed;
};
