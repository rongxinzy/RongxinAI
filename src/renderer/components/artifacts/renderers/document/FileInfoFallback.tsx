import { Button } from '@shared/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/components/ui/empty';
import { File, FileSpreadsheet, Presentation } from 'lucide-react';
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

  const Icon = ext === '.pptx' ? Presentation : ext === '.xlsx' ? FileSpreadsheet : File;

  return (
    <Empty className="h-full p-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon className="size-8 text-muted-foreground" aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{artifact.fileName || artifact.title}</EmptyTitle>
        <EmptyDescription>{ext.toUpperCase().slice(1)}</EmptyDescription>
      </EmptyHeader>
      {artifact.filePath && (
        <EmptyContent>
          <Button onClick={handleOpenWithApp} className="theme-page-document-renderer-button-1">
            {t('artifactOpenWithApp')}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
};
