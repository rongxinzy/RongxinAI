import React, { useEffect, useRef, useState } from 'react';

import type { Artifact } from '@/types/artifact';

import { destroyPdfDocument, t, useFileContent, type PdfDocumentHandle } from './documentShared';

// --- Pdf Sub-Renderer (pdfjs-dist, lazy page rendering) ---

const PDF_PAGE_GAP = 16;

export const PdfSubRenderer: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
  const { data, loading, error: loadError } = useFileContent(artifact);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PdfDocumentHandle | null>(null);
  const pdfDocRef = useRef<PdfDocumentHandle | null>(null);
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
    setPdfDoc(null);

    const loadPdf = async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.mjs',
          import.meta.url,
        ).href;

        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
        if (cancelled) {
          void destroyPdfDocument(pdf);
          return;
        }

        pdfDocRef.current = pdf;
        setPdfDoc(pdf);
        setPageCount(pdf.numPages);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };

    loadPdf();
    return () => {
      cancelled = true;
      const activePdfDoc = pdfDocRef.current;
      pdfDocRef.current = null;
      void destroyPdfDocument(activePdfDoc);
    };
  }, [data, loadError]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-destructive text-sm p-4">
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
