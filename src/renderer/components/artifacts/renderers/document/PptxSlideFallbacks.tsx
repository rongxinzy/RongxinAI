import React, { useEffect, useState } from 'react';

import { loadArtifactDataUrl } from '@/services/artifactFileLoader';
import type { Artifact } from '@/types/artifact';

import PptxSlideNavigator from '../PptxSlideNavigator';
import type { PptxPreviewSlide } from '../pptxSlideNavigation';
import { t } from './documentShared';
import { parsePptxSlides, type SlideContent } from './pptxTextExtraction';

// HTML slides fallback: load slideN.html files from the same directory
export const PptxHtmlFallback: React.FC<{ artifact: Artifact; data: ArrayBuffer }> = ({
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
