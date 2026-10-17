import React, { useEffect, useState } from 'react';

import type { Artifact } from '@/types/artifact';

import PptxSlideNavigator from '../PptxSlideNavigator';
import { normalizePptxData } from '../pptxDataNormalizer';
import { buildPptxSlideDocument, type PptxPreviewSlide } from '../pptxSlideNavigation';
import { t, useFileContent } from './documentShared';
import { PptxHtmlFallback } from './PptxSlideFallbacks';

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

export const PptxSubRenderer: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
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
