import { Button } from '@shared/components/ui/button';
import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { i18nService } from '@/services/i18n';
import { loadArtifactDataUrl } from '@/services/artifactFileLoader';
import type { Artifact } from '@/types/artifact';

import type { CsvPreviewWorkerResponse } from './csvPreview.worker';

import PptxSlideNavigator from './PptxSlideNavigator';
import { normalizePptxData } from './pptxDataNormalizer';
import { buildPptxSlideDocument, type PptxPreviewSlide } from './pptxSlideNavigation';

const t = (key: string) => i18nService.t(key);

function getExtension(name: string): string {
  const lastDot = name.lastIndexOf('.');
  return lastDot === -1 ? '' : name.slice(lastDot).toLowerCase();
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  if (!/^data:[^,]*;base64,/i.test(dataUrl)) {
    return new TextEncoder().encode(dataUrl).buffer;
  }
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function useFileContent(artifact: Artifact): {
  data: ArrayBuffer | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (artifact.content) {
        try {
          const buf = dataUrlToArrayBuffer(artifact.content);
          if (!cancelled) {
            setData(buf);
            setLoading(false);
          }
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : String(e));
            setLoading(false);
          }
        }
        return;
      }

      if (artifact.filePath) {
        try {
          const dataUrl = await loadArtifactDataUrl(artifact.filePath);
          if (cancelled) return;
          setData(dataUrlToArrayBuffer(dataUrl));
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        }
        setLoading(false);
        return;
      }

      setError('No content available');
      setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [artifact.content, artifact.filePath]);

  return { data, loading, error };
}

// --- Docx Sub-Renderer (docx-preview, high-fidelity rendering) ---

const DOCX_BASE_WIDTH = 794; // A4 width in px at 96dpi

const DocxSubRenderer: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
  const { data, loading, error: loadError } = useFileContent(artifact);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (loadError) {
      setError(loadError);
      return;
    }
    if (!data || !containerRef.current) return;

    let cancelled = false;

    const render = async () => {
      try {
        const { renderAsync } = await import('docx-preview');
        if (cancelled || !containerRef.current) return;

        containerRef.current.innerHTML = '';
        await renderAsync(data, containerRef.current, undefined, {
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

        if (!cancelled) setRendered(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };

    render();
    return () => {
      cancelled = true;
    };
  }, [data, loadError]);

  // Adaptive zoom based on container width
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !rendered) return;

    const updateZoom = () => {
      const containerWidth = wrapper.clientWidth - 48; // account for padding
      if (containerWidth < DOCX_BASE_WIDTH) {
        const scale = containerWidth / DOCX_BASE_WIDTH;
        if (containerRef.current) {
          containerRef.current.style.zoom = String(scale);
        }
      } else {
        if (containerRef.current) {
          containerRef.current.style.zoom = '1';
        }
      }
    };

    const ro = new ResizeObserver(updateZoom);
    ro.observe(wrapper);
    updateZoom();

    return () => ro.disconnect();
  }, [rendered]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500 text-sm p-4">
        {t('artifactDocumentError')}: {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t('artifactDocumentLoading')}
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="h-full overflow-auto p-6 bg-muted">
      <div ref={containerRef} className="docx-container mx-auto" />
      <style>{`
        .docx-container .docx-preview-wrapper {
          background: transparent !important;
        }
        .docx-container section.docx-preview {
          background: var(--card) !important;
          color: var(--foreground);
          box-shadow: var(--shadow-card);
          margin: 0 auto 16px !important;
          border-radius: 2px;
          padding: 60px 50px !important;
          box-sizing: border-box;
        }
      `}</style>
    </div>
  );
};

// --- Xlsx Sub-Renderer (virtual scrolling + cell styles + CSV/TSV support) ---

interface CellData {
  v: string;
  bgColor?: string;
  fontColor?: string;
  bold?: boolean;
  colSpan?: number;
  hidden?: boolean;
}

interface MergeRange {
  sr: number;
  sc: number;
  er: number;
  ec: number;
}

interface SheetData {
  name: string;
  rows: CellData[][];
  colCount: number;
}

function isCsvOrTsv(fileName: string): boolean {
  const ext = fileName.toLowerCase();
  return ext.endsWith('.csv') || ext.endsWith('.tsv') || ext.endsWith('.txt');
}

function applyMerges(rows: CellData[][], merges: MergeRange[]) {
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

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 32;

const XlsxSubRenderer: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
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
          const worker = new Worker(new URL('./csvPreview.worker.ts', import.meta.url), {
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
      <div className="flex items-center justify-center h-full text-red-500 text-sm p-4">
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
              className={`px-2 py-0.5 text-xs whitespace-nowrap transition-colors h-auto ${
                i === activeSheet
                  ? 'bg-accent text-accent-foreground font-medium hover:bg-accent hover:text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
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

// --- Pdf Sub-Renderer (pdfjs-dist, lazy page rendering) ---

const PDF_PAGE_GAP = 16;

const PdfSubRenderer: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
  const { data, loading, error: loadError } = useFileContent(artifact);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [renderWidth, setRenderWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Measure container width once it's laid out (debounced)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const measure = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const w = container.clientWidth - 48;
        if (w > 0 && Math.abs(w - renderWidth) > 5) setRenderWidth(w);
      }, 200);
    };

    // Initial measure without debounce
    const w = container.clientWidth - 48;
    if (w > 0) setRenderWidth(w);

    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [renderWidth, pdfDoc]);

  // Load PDF document
  useEffect(() => {
    if (loadError) {
      setError(loadError);
      return;
    }
    if (!data) return;

    let cancelled = false;

    const loadPdf = async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.mjs',
          import.meta.url,
        ).href;

        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
        if (cancelled) return;

        setPdfDoc(pdf);
        setPageCount(pdf.numPages);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };

    loadPdf();
    return () => {
      cancelled = true;
    };
  }, [data, loadError]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500 text-sm p-4">
        {t('artifactDocumentError')}: {error}
      </div>
    );
  }

  if (loading || !pdfDoc) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t('artifactDocumentLoading')}
      </div>
    );
  }

  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-muted">
      <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border shrink-0">
        {pageCount} {t('artifactPdfPageCount')}
      </div>
      <div ref={containerRef} className="flex-1 overflow-auto p-6">
        {renderWidth > 0 &&
          pages.map(pageNum => (
            <div key={pageNum} style={{ marginBottom: PDF_PAGE_GAP }}>
              <PdfPageCanvas pdfDoc={pdfDoc} pageNumber={pageNum} width={renderWidth} />
            </div>
          ))}
      </div>
    </div>
  );
};

const PdfPageCanvas: React.FC<{
  pdfDoc: unknown;
  pageNumber: number;
  width: number;
}> = ({ pdfDoc, pageNumber, width }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pdfDoc || width <= 0) return;

    // Cancel any in-progress render on this canvas
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    let cancelled = false;

    const renderPage = async () => {
      try {
        const page = await (pdfDoc as any).getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: 1 });
        const scale = width / viewport.width;
        const scaledViewport = page.getViewport({ scale });

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(scaledViewport.width * dpr);
        canvas.height = Math.floor(scaledViewport.height * dpr);
        canvas.style.width = `${Math.floor(scaledViewport.width)}px`;
        canvas.style.height = `${Math.floor(scaledViewport.height)}px`;
        setHeight(Math.floor(scaledViewport.height));

        const ctx = canvas.getContext('2d');
        if (!ctx || cancelled) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const renderTask = page.render({ canvasContext: ctx, viewport: scaledViewport });
        renderTaskRef.current = renderTask;

        await renderTask.promise;
        renderTaskRef.current = null;
      } catch (e) {
        // Ignore cancellation errors
        if (e instanceof Error && e.message.includes('Rendering cancelled')) return;
      }
    };

    renderPage();
    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdfDoc, pageNumber, width]);

  return (
    <canvas
      ref={canvasRef}
      className="mx-auto block bg-white shadow-md rounded-sm"
      style={{ minHeight: height || 200 }}
    />
  );
};

// --- Pptx Sub-Renderer ---

const PPTX_RENDER_WIDTH = 600;
const PPTX_RENDER_STAGE_HEIGHT = 600;

function snapshotPptxSlide(slideElement: HTMLElement): PptxPreviewSlide | null {
  const width = Number.parseFloat(slideElement.style.width) || PPTX_RENDER_WIDTH;
  const height = Number.parseFloat(slideElement.style.height);
  if (!Number.isFinite(height) || height <= 0) return null;

  const clone = slideElement.cloneNode(true) as HTMLElement;
  clone.style.position = 'relative';
  clone.style.top = '0';
  clone.style.margin = '0';

  const sourceCanvases = slideElement.querySelectorAll('canvas');
  const clonedCanvases = clone.querySelectorAll('canvas');
  sourceCanvases.forEach((sourceCanvas, index) => {
    const clonedCanvas = clonedCanvases[index];
    if (!clonedCanvas) return;

    try {
      const image = document.createElement('img');
      image.alt = '';
      image.src = sourceCanvas.toDataURL('image/png');
      image.style.cssText = clonedCanvas.style.cssText;
      image.width = sourceCanvas.width;
      image.height = sourceCanvas.height;
      clonedCanvas.replaceWith(image);
    } catch {
      // Keep the cloned canvas when browser security prevents a bitmap snapshot.
    }
  });

  return {
    srcDoc: buildPptxSlideDocument(clone.outerHTML),
    width,
    height,
  };
}

const PptxSubRenderer: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
  const { data, loading, error: loadError } = useFileContent(artifact);
  const [error, setError] = useState<string | null>(null);
  const [slides, setSlides] = useState<PptxPreviewSlide[]>([]);

  useEffect(() => {
    if (loadError) {
      setError(loadError);
      return;
    }
    if (!data) return;

    let cancelled = false;

    const render = async () => {
      let offscreen: HTMLDivElement | null = null;
      let previewer: ReturnType<(typeof import('pptx-preview'))['init']> | null = null;

      try {
        setError(null);
        setSlides([]);

        const pptxPreview = await import('pptx-preview');
        if (cancelled) return;

        const fixedData = await normalizePptxData(data);
        if (cancelled) return;

        offscreen = document.createElement('div');
        offscreen.style.cssText =
          'position:fixed;left:-10000px;top:-10000px;width:600px;height:600px;overflow:hidden;';
        document.body.appendChild(offscreen);

        previewer = pptxPreview.init(offscreen, {
          width: PPTX_RENDER_WIDTH,
          height: PPTX_RENDER_STAGE_HEIGHT,
          mode: 'slide',
        });
        await previewer.load(fixedData);
        if (cancelled) return;

        const count = previewer.slideCount || 0;
        const renderedSlides: PptxPreviewSlide[] = [];

        for (let index = 0; index < count; index++) {
          if (cancelled) return;
          previewer.renderSingleSlide(index);
          const slideElement = previewer.wrapper.querySelector<HTMLElement>(
            `.pptx-preview-slide-wrapper-${index}`,
          );
          if (!slideElement) break;

          await new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          });

          const snapshot = snapshotPptxSlide(slideElement);
          if (!snapshot) break;
          renderedSlides.push(snapshot);
        }

        if (renderedSlides.length === count && count > 0 && !cancelled) {
          setSlides(renderedSlides);
        } else if (!cancelled) {
          setError('render_failed');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        previewer?.destroy();
        offscreen?.remove();
      }
    };

    render();
    return () => {
      cancelled = true;
    };
  }, [data, loadError]);

  // Fallback: HTML slides or text extraction when pptx-preview fails
  if (error === 'render_failed') {
    return <PptxHtmlFallback artifact={artifact} data={data!} />;
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-destructive">
        {t('artifactDocumentError')}: {error}
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      {(loading || slides.length === 0) && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background text-sm text-muted-foreground">
          {t('artifactDocumentLoading')}
        </div>
      )}
      {slides.length > 0 && (
        <PptxSlideNavigator slides={slides} title={artifact.title || 'PPTX Preview'} />
      )}
    </div>
  );
};

// HTML slides fallback: load slideN.html files from the same directory
const PptxHtmlFallback: React.FC<{ artifact: Artifact; data: ArrayBuffer }> = ({
  artifact,
  data,
}) => {
  const [slides, setSlides] = useState<PptxPreviewSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [useTextFallback, setUseTextFallback] = useState(false);

  useEffect(() => {
    if (!artifact.filePath) {
      setUseTextFallback(true);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadSlideHtmls = async () => {
      const lastSeparator = Math.max(
        artifact.filePath!.lastIndexOf('/'),
        artifact.filePath!.lastIndexOf('\\'),
      );
      const dir = artifact.filePath!.substring(0, lastSeparator);
      const slidesDir = `${dir}/slides`;
      const nextSlides: PptxPreviewSlide[] = [];

      for (let i = 1; i <= 500; i++) {
        const slidePath = `${slidesDir}/slide${i}.html`;
        try {
          const dataUrl = await loadArtifactDataUrl(slidePath);
          const base64 = dataUrl.split(',')[1] || '';
          const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          const html = new TextDecoder('utf-8').decode(bytes);
          nextSlides.push({ srcDoc: html, width: 960, height: 540 });
        } catch {
          break;
        }
      }

      if (cancelled) return;

      if (nextSlides.length > 0) {
        setSlides(nextSlides);
      } else {
        setUseTextFallback(true);
      }
      setLoading(false);
    };

    loadSlideHtmls();
    return () => {
      cancelled = true;
    };
  }, [artifact.filePath]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t('artifactDocumentLoading')}
      </div>
    );
  }

  if (useTextFallback) {
    return <PptxTextFallback data={data} />;
  }

  return <PptxSlideNavigator slides={slides} title={artifact.title || 'PPTX Preview'} />;
};

// Text extraction fallback for PPTX
interface SlideContent {
  index: number;
  texts: string[];
}

async function parsePptxSlides(data: ArrayBuffer): Promise<SlideContent[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(data);
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
      const nb = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
      return na - nb;
    });

  const slides: SlideContent[] = [];
  const textRe = /<a:t>([^<]*)<\/a:t>/g;

  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.file(slideFiles[i])!.async('string');
    const texts: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = textRe.exec(xml)) !== null) {
      if (match[1].trim()) texts.push(match[1]);
    }
    textRe.lastIndex = 0;
    slides.push({ index: i + 1, texts });
  }
  return slides;
}

const PptxTextFallback: React.FC<{ data: ArrayBuffer }> = ({ data }) => {
  const [slides, setSlides] = useState<SlideContent[]>([]);
  const [parsed, setParsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    parsePptxSlides(data)
      .then(result => {
        if (!cancelled) {
          setSlides(result);
          setParsed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setParsed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (!parsed) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t('artifactDocumentLoading')}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border shrink-0">
        {t('artifactSlideCount').replace('{count}', String(slides.length))}
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {slides.map(slide => (
          <div key={slide.index} className="border border-border rounded-lg p-4 bg-surface">
            <div className="text-xs text-muted-foreground mb-2 font-medium">
              {t('artifactSlideLabel').replace('{n}', String(slide.index))}
            </div>
            {slide.texts.length > 0 ? (
              <div className="space-y-1">
                {slide.texts.map((text, i) => (
                  <div key={i} className="text-sm text-foreground">
                    {text}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground italic">{t('artifactSlideNoText')}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Fallback Sub-Renderer ---

const FileInfoFallback: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
  const ext = getExtension(artifact.fileName || artifact.filePath || '');

  const handleOpenWithApp = useCallback(() => {
    if (artifact.filePath) {
      window.electron?.shell?.openPath(artifact.filePath);
    }
  }, [artifact.filePath]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
      <div className="text-5xl">{ext === '.pptx' ? '📊' : ext === '.xlsx' ? '📑' : '📄'}</div>
      <div className="text-center">
        <div className="text-sm font-medium">{artifact.fileName || artifact.title}</div>
        <div className="text-xs text-muted-foreground mt-1">{ext.toUpperCase().slice(1)}</div>
      </div>
      {artifact.filePath && (
        <Button onClick={handleOpenWithApp} className="px-3 py-1.5 text-xs mt-2 h-auto">
          {t('artifactOpenWithApp')}
        </Button>
      )}
    </div>
  );
};

// --- Main Document Renderer ---

interface DocumentRendererProps {
  artifact: Artifact;
}

const DocumentRenderer: React.FC<DocumentRendererProps> = ({ artifact }) => {
  const ext = getExtension(artifact.fileName || artifact.filePath || '');
  const language = artifact.language?.toLowerCase();

  switch (ext) {
    case '.docm':
    case '.docx':
    case '.dotm':
    case '.dotx':
      return <DocxSubRenderer artifact={artifact} />;
    case '.xlsx':
    case '.xls':
    case '.xlsm':
    case '.xlam':
    case '.xlt':
    case '.xltm':
    case '.xltx':
    case '.csv':
    case '.tsv':
      return <XlsxSubRenderer artifact={artifact} />;
    case '.pdf':
      return <PdfSubRenderer artifact={artifact} />;
    case '.pptx':
    case '.pptm':
    case '.potm':
    case '.potx':
    case '.ppsm':
    case '.ppsx':
      return <PptxSubRenderer artifact={artifact} />;
    default:
      return language === 'csv' || language === 'tsv' ? (
        <XlsxSubRenderer artifact={artifact} />
      ) : (
        <FileInfoFallback artifact={artifact} />
      );
  }
};

export default DocumentRenderer;
