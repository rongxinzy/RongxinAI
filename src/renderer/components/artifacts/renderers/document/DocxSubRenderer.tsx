import React, { useEffect, useRef, useState } from 'react';

import type { Artifact } from '@/types/artifact';

import { t, useFileContent } from './documentShared';

// --- Docx Sub-Renderer (docx-preview, high-fidelity rendering) ---

const DOCX_BASE_WIDTH = 794; // A4 width in px at 96dpi

export const DocxSubRenderer: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
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
      <div className="flex items-center justify-center h-full text-destructive text-sm p-4">
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
