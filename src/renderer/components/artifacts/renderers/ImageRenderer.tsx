import { Button } from '@shared/components/ui/button';
import React, { useCallback, useState } from 'react';

import type { Artifact } from '@/types/artifact';
import { i18nService } from '@/services/i18n';
import { toLocalfileUrl } from '@/utils/localfileUrl';
import { resolveArtifactPath } from '@shared/cowork/artifactPath';

interface ImageRendererProps {
  artifact: Artifact;
  cwd?: string | null;
  revision?: number;
}

const ImageRenderer: React.FC<ImageRendererProps> = ({ artifact, cwd, revision = 0 }) => {
  const [retry, setRetry] = useState(0);
  const source = artifact.filePath
    ? `${toLocalfileUrl(resolveArtifactPath(artifact.filePath, cwd))}?revision=${encodeURIComponent(artifact.id)}-${revision}-${retry}`
    : artifact.content;
  const [zoom, setZoom] = useState({ source, scale: 1 });
  const scale = zoom.source === source ? zoom.scale : 1;
  const [failedSource, setFailedSource] = useState<string | null>(null);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(prev => ({
          source,
          scale: Math.max(
            0.1,
            Math.min(5, (prev.source === source ? prev.scale : 1) - e.deltaY * 0.001),
          ),
        }));
      }
    },
    [source],
  );

  const resetZoom = useCallback(() => setZoom({ source, scale: 1 }), [source]);

  if (!source) {
    return (
      <div className="theme-conversation-image-status flex items-center justify-center h-full">
        {i18nService.t('imageReadError')}
      </div>
    );
  }

  if (failedSource === source) {
    return (
      <div
        className="theme-conversation-image-status flex h-full flex-col items-center justify-center gap-3"
        role="status"
      >
        {i18nService.t('imageReadError')}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setFailedSource(null);
            setRetry(value => value + 1);
          }}
        >
          {i18nService.t('artifactImageRetry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-auto" onWheel={handleWheel}>
      <div
        className="theme-conversation-image-stage flex items-center justify-center min-h-full"
        style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
      >
        <img
          src={source}
          alt={artifact.title}
          className="max-w-full max-h-full object-contain"
          onError={() => setFailedSource(source)}
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
