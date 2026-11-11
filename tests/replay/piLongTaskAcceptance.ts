import fs from 'node:fs';
import path from 'node:path';

/** Task-specific test acceptance; never injected into the agent runtime. */
export function inspectLongTaskArtifacts(workDir: string, docCount: number): string[] {
  const errors: string[] = [];
  const read = (name: string): string => {
    try {
      return fs.readFileSync(path.join(workDir, name), 'utf8');
    } catch {
      errors.push(`${name} is missing or unreadable`);
      return '';
    }
  };
  const expected = Array.from(
    { length: docCount },
    (_, index) => `doc-${String(index + 1).padStart(3, '0')}`,
  );
  const summaries = read('summaries.md');
  const summaryIds = [...summaries.matchAll(/^##\s+(doc-\d{3})\b/gm)].map(match => match[1]);
  if (summaryIds.join(',') !== expected.join(',')) {
    errors.push(`summaries.md must contain all ${docCount} document sections in order`);
  }
  const rows = parseCsv(read('index.csv'));
  const indexIds = rows.slice(1).map(row => {
    const id = row[0]?.trim() ?? '';
    return /^\d{3}$/.test(id) ? `doc-${id}` : id;
  });
  if (
    rows[0]?.length !== 4 ||
    rows.slice(1).some(row => row.length !== 4) ||
    indexIds.join(',') !== expected.join(',')
  ) {
    errors.push(
      `index.csv must contain a four-column header and all ${docCount} documents in order`,
    );
  }
  const report = read('report.md');
  if ((report.match(/\p{Script=Han}/gu)?.length ?? 0) < 1500) {
    errors.push('report.md must contain at least 1500 Chinese characters');
  }
  return errors;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(field.replace(/\r$/, ''));
      field = '';
      if (char === '\n') {
        if (row.some(value => value.trim())) rows.push(row);
        row = [];
      }
    } else field += char;
  }
  row.push(field.replace(/\r$/, ''));
  if (row.some(value => value.trim())) rows.push(row);
  return quoted ? [] : rows;
}
