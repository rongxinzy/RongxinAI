import { renderAsync } from 'docx-preview';
import * as XLSX from 'xlsx';

type OfficePreviewKind = 'docs' | 'sheets';

interface OfficePreviewRequest {
  kind: OfficePreviewKind;
  fileName: string;
  dataBase64: string;
}

interface OfficePreviewBounds {
  width: number;
  height: number;
}

declare global {
  interface Window {
    zhiyuanRenderOfficePreview: (request: OfficePreviewRequest) => Promise<OfficePreviewBounds>;
  }
}

const root = document.querySelector<HTMLElement>('#office-preview-root');
if (!root) throw new Error('Office preview root is missing.');

const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const applyBaseStyles = (): void => {
  document.documentElement.style.cssText = 'margin:0;background:#e8ebef;';
  document.body.style.cssText =
    'margin:0;padding:32px;box-sizing:border-box;background:#e8ebef;color:#111827;font-family:Arial,"Noto Sans CJK SC",sans-serif;';
  root.style.cssText = 'display:block;width:max-content;max-width:100%;margin:0 auto;';
  root.replaceChildren();
};

const renderDocx = async (bytes: Uint8Array): Promise<void> => {
  await renderAsync(bytes.buffer, root, undefined, {
    className: 'docx-preview',
    inWrapper: true,
    breakPages: true,
    ignoreWidth: false,
    ignoreHeight: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
  });
  const pages = [...root.querySelectorAll<HTMLElement>('section.docx-preview')];
  if (pages.length === 0) throw new Error('The DOCX renderer produced no page.');
  for (const page of pages.slice(1)) page.remove();
  const page = pages[0];
  page.style.margin = '0';
  page.style.boxShadow = '0 12px 36px rgba(15, 23, 42, 0.20)';
  page.style.background = '#ffffff';
  const wrapper = root.querySelector<HTMLElement>('.docx-preview-wrapper');
  if (wrapper) {
    wrapper.style.padding = '0';
    wrapper.style.background = 'transparent';
  }
};

const cellText = (cell: XLSX.CellObject | undefined): string => {
  if (!cell) return '';
  if (typeof cell.w === 'string') return cell.w;
  if (cell.v === undefined || cell.v === null) return '';
  return String(cell.v);
};

const applyCellStyle = (element: HTMLTableCellElement, cell: XLSX.CellObject | undefined): void => {
  const style = cell?.s as
    | {
        fgColor?: { rgb?: string };
        font?: { color?: { rgb?: string }; bold?: boolean };
        color?: { rgb?: string };
        bold?: boolean;
        alignment?: { horizontal?: string };
      }
    | undefined;
  const background = style?.fgColor?.rgb;
  const foreground = style?.font?.color?.rgb || style?.color?.rgb;
  if (background) element.style.backgroundColor = `#${background.slice(-6)}`;
  if (foreground) element.style.color = `#${foreground.slice(-6)}`;
  if (style?.font?.bold || style?.bold) element.style.fontWeight = '700';
  if (style?.alignment?.horizontal) element.style.textAlign = style.alignment.horizontal;
};

const renderSheet = (bytes: Uint8Array, fileName: string): void => {
  const isText = /\.(csv|tsv)$/i.test(fileName);
  const workbook = isText
    ? XLSX.read(new TextDecoder().decode(bytes), { type: 'string', cellStyles: true })
    : XLSX.read(bytes, { type: 'array', cellStyles: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('The spreadsheet contains no worksheet.');
  const sheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const lastRow = Math.min(range.e.r, range.s.r + 59);
  const lastColumn = Math.min(range.e.c, range.s.c + 19);

  const card = document.createElement('section');
  card.style.cssText =
    'width:max-content;max-width:1536px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 12px 36px rgba(15,23,42,.20);';
  const title = document.createElement('header');
  title.textContent = sheetName;
  title.style.cssText =
    'padding:14px 18px;background:#f8fafc;border-bottom:1px solid #cbd5e1;font-size:16px;font-weight:700;';
  card.append(title);

  const scroller = document.createElement('div');
  scroller.style.cssText = 'overflow:hidden;max-width:1536px;';
  const table = document.createElement('table');
  table.style.cssText =
    'border-collapse:collapse;table-layout:fixed;background:#fff;font-size:13px;line-height:1.35;';
  const columnWidths = sheet['!cols'] || [];
  const columnGroup = document.createElement('colgroup');
  for (let column = range.s.c; column <= lastColumn; column += 1) {
    const col = document.createElement('col');
    const configuredWidth = columnWidths[column]?.wpx;
    col.style.width = `${Math.max(72, Math.min(240, configuredWidth || 120))}px`;
    columnGroup.append(col);
  }
  table.append(columnGroup);

  const merges = sheet['!merges'] || [];
  const covered = new Set<string>();
  const mergeAt = new Map<string, XLSX.Range>();
  for (const merge of merges) {
    const startKey = `${merge.s.r}:${merge.s.c}`;
    mergeAt.set(startKey, merge);
    for (let row = merge.s.r; row <= merge.e.r; row += 1) {
      for (let column = merge.s.c; column <= merge.e.c; column += 1) {
        if (row !== merge.s.r || column !== merge.s.c) covered.add(`${row}:${column}`);
      }
    }
  }

  const body = document.createElement('tbody');
  for (let row = range.s.r; row <= lastRow; row += 1) {
    const tr = document.createElement('tr');
    for (let column = range.s.c; column <= lastColumn; column += 1) {
      const key = `${row}:${column}`;
      if (covered.has(key)) continue;
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = sheet[address];
      const td = document.createElement('td');
      td.textContent = cellText(cell);
      td.style.cssText =
        'height:28px;padding:5px 8px;border:1px solid #d6dce5;box-sizing:border-box;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;vertical-align:middle;';
      applyCellStyle(td, cell);
      const merge = mergeAt.get(key);
      if (merge) {
        td.colSpan = Math.min(merge.e.c, lastColumn) - column + 1;
        td.rowSpan = Math.min(merge.e.r, lastRow) - row + 1;
      }
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);
  scroller.append(table);
  card.append(scroller);
  root.append(card);
};

window.zhiyuanRenderOfficePreview = async request => {
  applyBaseStyles();
  const bytes = decodeBase64(request.dataBase64);
  if (request.kind === 'docs') await renderDocx(bytes);
  else renderSheet(bytes, request.fileName);
  await document.fonts.ready;
  await new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  const bounds = root.getBoundingClientRect();
  const width = Math.ceil(Math.min(1600, Math.max(320, bounds.width + 64)));
  const height = Math.ceil(Math.min(2400, Math.max(240, bounds.height + 64)));
  document.body.style.width = `${width}px`;
  document.body.style.height = `${height}px`;
  return { width, height };
};
