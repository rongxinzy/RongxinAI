import React, { useEffect, useState } from 'react';

import MarkdownContent from '@/components/MarkdownContent';
import { loadArtifactFile } from '@/services/artifactFileLoader';
import { i18nService } from '@/services/i18n';
import type { Artifact } from '@/types/artifact';

const t = (key: string) => i18nService.t(key);

interface MarkdownRendererProps {
  artifact: Artifact;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ artifact }) => {
  const [content, setContent] = useState(artifact.content);
  const [loading, setLoading] = useState(!artifact.content && Boolean(artifact.filePath));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (artifact.content) {
      setContent(artifact.content);
      setLoading(false);
      setError(null);
      return undefined;
    }

    if (!artifact.filePath) {
      setContent('');
      setLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    loadArtifactFile(artifact)
      .then(loaded => {
        if (cancelled) return;
        setContent(loaded?.content ?? '');
      })
      .catch(loadError => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [artifact]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('artifactDocumentLoading')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('artifactDocumentError')}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <MarkdownContent content={content} />
    </div>
  );
};

export default MarkdownRenderer;
