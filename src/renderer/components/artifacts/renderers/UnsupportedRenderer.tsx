import { Button } from '@shared/components/ui/button';
import { ExternalLink, FileWarning } from 'lucide-react';
import React, { useCallback } from 'react';

import { i18nService } from '@/services/i18n';
import type { Artifact } from '@/types/artifact';

const t = (key: string) => i18nService.t(key);

interface UnsupportedRendererProps {
  artifact: Artifact;
}

function normalizeFilePath(filePath: string): string {
  let normalized = filePath;
  if (normalized.startsWith('file:///') || normalized.startsWith('file://')) {
    normalized = normalized.slice(7);
  } else if (normalized.startsWith('file:/')) {
    normalized = normalized.slice(5);
  }
  return /^\/[A-Za-z]:/.test(normalized) ? normalized.slice(1) : normalized;
}

const UnsupportedRenderer: React.FC<UnsupportedRendererProps> = ({ artifact }) => {
  const handleOpenWithApp = useCallback(() => {
    if (artifact.filePath) {
      void window.electron?.shell?.openPath(normalizeFilePath(artifact.filePath));
    }
  }, [artifact.filePath]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <FileWarning className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{t('artifactPreviewUnsupported')}</p>
      {artifact.filePath && (
        <Button variant="outline" onClick={handleOpenWithApp}>
          <ExternalLink className="size-4" />
          {t('artifactOpenWithApp')}
        </Button>
      )}
    </div>
  );
};

export default UnsupportedRenderer;
