import { Button } from '@shared/components/ui/button';
import DOMPurify from 'dompurify';
import React, { useCallback, useMemo, useRef, useState } from 'react';

import type { Artifact } from '@/types/artifact';

interface SvgRendererProps {
  artifact: Artifact;
}

const SvgRenderer: React.FC<SvgRendererProps> = ({ artifact }) => {
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const sanitizedSvg = useMemo(() => {
    if (!artifact.content) return '';
    return DOMPurify.sanitize(artifact.content, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ['use'],
    });
  }, [artifact.content]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setScale(prev => Math.max(0.1, Math.min(5, prev - e.deltaY * 0.001)));
    }
  }, []);

  const resetZoom = useCallback(() => setScale(1), []);

  return (
    <div className="relative w-full h-full overflow-auto" ref={containerRef} onWheel={handleWheel}>
      <div
        className="flex items-center justify-center min-h-full p-4"
        style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
        dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
      />
      {scale !== 1 && (
        <Button
          variant="secondary"
          size="sm"
          onClick={resetZoom}
          className="theme-action-overlay-compact absolute bottom-3 right-3"
        >
          {Math.round(scale * 100)}%
        </Button>
      )}
    </div>
  );
};

export default SvgRenderer;
