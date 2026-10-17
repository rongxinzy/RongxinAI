import { Button } from '@shared/components/ui/button';
import React, { useCallback } from 'react';

import type { Artifact } from '@/types/artifact';

import { getExtension, t } from './documentShared';

// --- Fallback Sub-Renderer ---

export const FileInfoFallback: React.FC<{ artifact: Artifact }> = ({ artifact }) => {
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
        <Button onClick={handleOpenWithApp} className="theme-page-document-renderer-button-1 mt-2">
          {t('artifactOpenWithApp')}
        </Button>
      )}
    </div>
  );
};
