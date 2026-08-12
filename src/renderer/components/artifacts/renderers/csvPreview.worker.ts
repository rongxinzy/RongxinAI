export interface CsvPreviewCell {
  v: string;
}

export interface CsvPreviewWorkerRequest {
  text: string;
  delimiter: string;
}

export interface CsvPreviewWorkerResponse {
  rows: CsvPreviewCell[][];
  colCount: number;
}

function parseDelimitedText(text: string, delimiter: string): CsvPreviewWorkerResponse {
  const rows: CsvPreviewCell[][] = [];
  let row: CsvPreviewCell[] = [];
  let field = '';
  let quoted = false;

  const pushField = () => {
    row.push({ v: field });
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (row.some(cell => cell.v.length > 0) || rows.length > 0) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && char === delimiter) {
      pushField();
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      pushRow();
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();

  const colCount = rows.reduce((max, current) => Math.max(max, current.length), 0);
  for (const current of rows) {
    while (current.length < colCount) current.push({ v: '' });
  }
  return { rows, colCount };
}

self.onmessage = (event: MessageEvent<CsvPreviewWorkerRequest>) => {
  const { text, delimiter } = event.data;
  self.postMessage(parseDelimitedText(text, delimiter) satisfies CsvPreviewWorkerResponse);
};
