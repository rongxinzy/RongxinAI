import { Button } from '@shared/components/ui/button';
import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useEffect, useRef, useState } from 'react';

import type { Artifact } from '@/types/artifact';

import type { CsvPreviewWorkerResponse } from '../csvPreview.worker';
import { t, useFileContent } from './documentShared';
import {
  applyMerges,
  isCsvOrTsv,
  type CellData,
  type MergeRange,
  type SheetData,
} from './xlsxSheetModel';

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 32;

// --- Xlsx Sub-Renderer (virtual scrolling + cell styles + CSV/TSV support) ---

export const XlsxSubRenderer: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
  const { data, loading, error: loadError } = useFileContent(artifact);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loadError) {
      setError(loadError);
      return;
    }
    if (!data) return;

    let cancelled = false;

    const parse = async () => {
      try {
        const fileName = artifact.fileName || artifact.filePath || '';
        if (isCsvOrTsv(fileName) || artifact.language === 'csv' || artifact.language === 'tsv') {
          const text = new TextDecoder('utf-8').decode(new Uint8Array(data));
          const delimiter =
            fileName.toLowerCase().endsWith('.tsv') || artifact.language === 'tsv' ? '\t' : ',';
          const worker = new Worker(new URL('../csvPreview.worker.ts', import.meta.url), {
            type: 'module',
          });
          worker.onmessage = (event: MessageEvent<CsvPreviewWorkerResponse>) => {
            if (!cancelled) {
              setSheets([{ name: 'Sheet1', ...event.data }]);
            }
            worker.terminate();
          };
          worker.onerror = () => {
            if (!cancelled) setError(t('artifactDocumentError'));
            worker.terminate();
          };
          worker.postMessage({ text, delimiter });
          return;
        }

        const XLSX = await import('xlsx');
        const workbook = XLSX.read(new Uint8Array(data), { type: 'array', cellStyles: true });
        const parsed: SheetData[] = workbook.SheetNames.map(name => {
          const sheet = workbook.Sheets[name];
          const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
          const colCount = range.e.c - range.s.c + 1;
          const rows: CellData[][] = [];

          for (let r = range.s.r; r <= range.e.r; r++) {
            const row: CellData[] = [];
            for (let c = range.s.c; c <= range.e.c; c++) {
              const addr = XLSX.utils.encode_cell({ r, c });
              const cell = sheet[addr];
              if (cell) {
                const cellData: CellData = { v: cell.w ?? String(cell.v ?? '') };
                if (cell.s) {
                  if (cell.s.fgColor?.rgb) cellData.bgColor = `#${cell.s.fgColor.rgb}`;
                  if (cell.s.color?.rgb) cellData.fontColor = `#${cell.s.color.rgb}`;
                  if (cell.s.bold) cellData.bold = true;
                }
                row.push(cellData);
              } else {
                row.push({ v: '' });
              }
            }
            rows.push(row);
          }

          const merges: MergeRange[] = (sheet['!merges'] || []).map(
            (m: { s: { r: number; c: number }; e: { r: number; c: number } }) => ({
              sr: m.s.r - range.s.r,
              sc: m.s.c - range.s.c,
              er: m.e.r - range.s.r,
              ec: m.e.c - range.s.c,
            }),
          );
          applyMerges(rows, merges);

          return { name, rows, colCount };
        });

        if (!cancelled) setSheets(parsed);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };

    parse();
    return () => {
      cancelled = true;
    };
  }, [data, loadError, artifact.fileName, artifact.filePath, artifact.language]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-destructive text-sm p-4">
        {t('artifactDocumentError')}: {error}
      </div>
    );
  }

  if (loading || sheets.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t('artifactDocumentLoading')}
      </div>
    );
  }

  const currentSheet = sheets[activeSheet];
  const headerRow = currentSheet.rows[0];
  const bodyRows = currentSheet.rows.slice(1);
  const colCount = currentSheet.colCount;
  const COL_WIDTH = Math.max(100, Math.min(200, Math.floor(800 / colCount)));
  const totalWidth = COL_WIDTH * colCount;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-card text-foreground">
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-1 border-b border-border shrink-0 overflow-x-auto">
          {sheets.map((sheet, i) => (
            <Button
              key={i}
              variant={i === activeSheet ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveSheet(i)}
              className={` theme-page-document-renderer-button-variant-3 whitespace-nowrap ${
                i === activeSheet
                  ? 'theme-page-document-renderer-button-variant-1'
                  : 'theme-page-document-renderer-button-variant-2'
              }`}
            >
              {sheet.name}
            </Button>
          ))}
        </div>
      )}

      {/* Scrollable table area */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div style={{ width: totalWidth, minWidth: '100%' }}>
          {/* Header */}
          {headerRow && (
            <div
              className="flex sticky top-0 z-10 border-b border-border bg-muted"
              style={{ height: HEADER_HEIGHT }}
            >
              {headerRow.map((cell, i) => {
                if (cell.hidden) return null;
                const span = cell.colSpan || 1;
                return (
                  <div
                    key={i}
                    className="px-3 flex items-center text-xs font-medium text-foreground border-r border-border last:border-r-0 truncate"
                    style={{
                      width: COL_WIDTH * span,
                      minWidth: COL_WIDTH * span,
                      backgroundColor: cell.bgColor || undefined,
                      color: cell.fontColor || undefined,
                      fontWeight: cell.bold ? 700 : 600,
                    }}
                    title={cell.v}
                  >
                    {cell.v}
                  </div>
                );
              })}
            </div>
          )}

          {/* Virtual scrolling body */}
          <VirtualRows rows={bodyRows} parentRef={parentRef} colWidth={COL_WIDTH} />
        </div>
      </div>

      {/* Row count */}
      <div className="px-3 py-1 text-xs text-muted-foreground border-t border-border shrink-0">
        {currentSheet.rows.length.toLocaleString()} {t('artifactRowCount')}
      </div>
    </div>
  );
};

const VirtualRows: React.FC<{
  rows: CellData[][];
  parentRef: React.RefObject<HTMLDivElement | null>;
  colWidth: number;
}> = ({ rows, parentRef, colWidth }) => {
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
    initialRect: { width: 0, height: 600 },
  });

  return (
    <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
      {rowVirtualizer.getVirtualItems().map(virtualRow => {
        const row = rows[virtualRow.index];
        return (
          <div
            key={virtualRow.index}
            className={`flex items-center border-b border-border/50 text-xs ${virtualRow.index % 2 === 0 ? 'bg-card' : 'bg-muted/30'}`}
            style={{
              position: 'absolute',
              top: 0,
              transform: `translateY(${virtualRow.start}px)`,
              height: ROW_HEIGHT,
            }}
          >
            {row.map((cell, ci) => {
              if (cell.hidden) return null;
              const span = cell.colSpan || 1;
              return (
                <div
                  key={ci}
                  className="px-3 flex items-center border-r border-border/30 last:border-r-0 truncate h-full"
                  style={{
                    width: colWidth * span,
                    minWidth: colWidth * span,
                    backgroundColor: cell.bgColor || undefined,
                    color: cell.fontColor || undefined,
                    fontWeight: cell.bold ? 700 : undefined,
                  }}
                  title={cell.v}
                >
                  {cell.v}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
