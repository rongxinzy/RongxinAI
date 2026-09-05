import { Button } from '@shared/components/ui/button';
import React, { useCallback, useState } from 'react';

import type { Artifact } from '@/types/artifact';

interface ImageRendererProps {
  artifact: Artifact;
}

const ImageRenderer: React.FC<ImageRendererProps> = ({ artifact }) => {
  const [scale, setScale] = useState(1);
  const [error, setError] = useState(false);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setScale(prev => Math.max(0.1, Math.min(5, prev - e.deltaY * 0.001)));
    }
  }, []);

  const resetZoom = useCallback(() => setScale(1), []);

  if (!artifact.content) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading image...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Failed to load image
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-auto" onWheel={handleWheel}>
      <div
        className="flex items-center justify-center min-h-full p-4"
        style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
      >
        <img
          src={artifact.content}
          alt={artifact.title}
          className="max-w-full max-h-full object-contain"
          onError={() => setError(true)}
        />
      </div>
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

export default ImageRenderer;
