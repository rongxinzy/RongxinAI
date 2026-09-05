import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { i18nService } from '@/services/i18n';

import {
  isPptxNavigationKey,
  type PptxPreviewSlide,
  resolvePptxSlideIndex,
} from './pptxSlideNavigation';

const t = (key: string) => i18nService.t(key);

const THUMBNAIL_WIDTH = 132;
const THUMBNAIL_ROW_PADDING = 38;

interface ScaledSlideProps {
  slide: PptxPreviewSlide;
  scale: number;
  title: string;
  lazy?: boolean;
}

const ScaledSlide = memo<ScaledSlideProps>(({ slide, scale, title, lazy = false }) => {
  const scaledWidth = slide.width * scale;
  const scaledHeight = slide.height * scale;

  return (
    <div
      className="relative overflow-hidden bg-background"
      style={{ width: scaledWidth, height: scaledHeight, contain: 'layout paint' }}
    >
      <iframe
        aria-hidden={lazy || undefined}
        className="pointer-events-none absolute inset-0 select-none border-0"
        loading={lazy ? 'lazy' : 'eager'}
        sandbox=""
        srcDoc={slide.srcDoc}
        style={{
          width: slide.width,
          height: slide.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          willChange: lazy ? undefined : 'transform',
        }}
        tabIndex={-1}
        title={title}
      />
    </div>
  );
});

ScaledSlide.displayName = 'ScaledSlide';

interface PptxSlideNavigatorProps {
  slides: PptxPreviewSlide[];
  title: string;
}

const PptxSlideNavigator: React.FC<PptxSlideNavigatorProps> = ({ slides, title }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [mainScale, setMainScale] = useState(0);
  const thumbnailScrollRef = useRef<HTMLDivElement>(null);
  const mainViewportRef = useRef<HTMLDivElement>(null);

  const selectedSlide = slides[selectedIndex] ?? slides[0];
  const thumbnailHeight = slides[0] ? (THUMBNAIL_WIDTH * slides[0].height) / slides[0].width : 0;

  const rowVirtualizer = useVirtualizer({
    count: slides.length,
    getScrollElement: () => thumbnailScrollRef.current,
    estimateSize: () => thumbnailHeight + THUMBNAIL_ROW_PADDING,
    overscan: 3,
  });

  useEffect(() => {
    setSelectedIndex(0);
  }, [slides]);

  useEffect(() => {
    rowVirtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
  }, [rowVirtualizer, selectedIndex]);

  useEffect(() => {
    const viewport = mainViewportRef.current;
    if (!viewport || !selectedSlide) return;

    const updateScale = () => {
      const styles = window.getComputedStyle(viewport);
      const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const availableWidth = Math.max(0, viewport.clientWidth - horizontalPadding);
      const availableHeight = Math.max(0, viewport.clientHeight - verticalPadding);
      const nextScale = Math.min(
        availableWidth / selectedSlide.width,
        availableHeight / selectedSlide.height,
      );
      setMainScale(Number.isFinite(nextScale) ? Math.max(nextScale, 0) : 0);
    };

    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    updateScale();
    return () => observer.disconnect();
  }, [selectedSlide]);

  const selectSlide = useCallback(
    (index: number) => {
      setSelectedIndex(Math.min(Math.max(index, 0), slides.length - 1));
    },
    [slides.length],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!isPptxNavigationKey(event.key)) return;
      event.preventDefault();
      setSelectedIndex(current => resolvePptxSlideIndex(current, slides.length, event.key));
    },
    [slides.length],
  );

  const positionLabel = useMemo(
    () =>
      t('artifactSlidePosition')
        .replace('{current}', String(selectedIndex + 1))
        .replace('{total}', String(slides.length)),
    [selectedIndex, slides.length],
  );

  if (!selectedSlide) return null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex h-10 shrink-0 items-center border-b border-border px-2">
        <Button
          aria-label={t(showThumbnails ? 'artifactHideThumbnails' : 'artifactShowThumbnails')}
          onClick={() => setShowThumbnails(value => !value)}
          size="icon-sm"
          title={t(showThumbnails ? 'artifactHideThumbnails' : 'artifactShowThumbnails')}
          variant="ghost"
        >
          {showThumbnails ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
          <Button
            aria-label={t('artifactPreviousSlide')}
            disabled={selectedIndex === 0}
            onClick={() => selectSlide(selectedIndex - 1)}
            size="icon-sm"
            title={t('artifactPreviousSlide')}
            variant="ghost"
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-20 text-center text-xs tabular-nums text-muted-foreground">
            {positionLabel}
          </span>
          <Button
            aria-label={t('artifactNextSlide')}
            disabled={selectedIndex === slides.length - 1}
            onClick={() => selectSlide(selectedIndex + 1)}
            size="icon-sm"
            title={t('artifactNextSlide')}
            variant="ghost"
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="size-7" aria-hidden="true" />
      </div>

      <div className="flex min-h-0 flex-1">
        {showThumbnails && (
          <aside
            aria-label={t('artifactPptxThumbnails')}
            className="flex w-40 shrink-0 flex-col border-r border-border bg-muted/30"
          >
            <div
              ref={thumbnailScrollRef}
              className="min-h-0 flex-1 overflow-auto py-1"
              tabIndex={0}
              onKeyDown={handleKeyDown}
            >
              <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
                {rowVirtualizer.getVirtualItems().map(virtualSlide => {
                  const slide = slides[virtualSlide.index];
                  const scale = THUMBNAIL_WIDTH / slide.width;
                  const slideLabel = t('artifactSlideLabel').replace(
                    '{n}',
                    String(virtualSlide.index + 1),
                  );
                  const selected = virtualSlide.index === selectedIndex;

                  return (
                    <div
                      key={virtualSlide.key}
                      className="absolute left-0 top-0 w-full px-2 py-1"
                      style={{ transform: `translateY(${virtualSlide.start}px)` }}
                    >
                      <button
                        aria-current={selected ? 'page' : undefined}
                        aria-label={slideLabel}
                        className={cn(
                          'theme-native-slide flex w-full flex-col items-center gap-1 p-1 text-left',
                          selected ? 'theme-native-slide-selected' : 'theme-native-slide-idle',
                        )}
                        type="button"
                        onClick={() => selectSlide(virtualSlide.index)}
                      >
                        <div
                          className={cn(
                            'overflow-hidden rounded-sm border bg-background shadow-sm',
                            selected ? 'border-primary' : 'border-border',
                          )}
                        >
                          <ScaledSlide lazy scale={scale} slide={slide} title={slideLabel} />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {virtualSlide.index + 1}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        )}

        <div
          ref={mainViewportRef}
          aria-label={t('artifactPptxCanvas')}
          className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-muted/50 p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          role="region"
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          {mainScale > 0 && (
            <div className="overflow-hidden rounded-sm border border-border shadow-lg">
              <ScaledSlide
                scale={mainScale}
                slide={selectedSlide}
                title={`${title} — ${positionLabel}`}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PptxSlideNavigator;
