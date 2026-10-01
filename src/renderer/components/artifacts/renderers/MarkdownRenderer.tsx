import React, { useEffect, useState } from 'react';

import MarkdownContent from '@/components/MarkdownContent';
import { loadArtifactDataUrl } from '@/services/artifactFileLoader';
import { i18nService } from '@/services/i18n';
import type { Artifact } from '@/types/artifact';

const t = (key: string) => i18nService.t(key);

interface MarkdownRendererProps {
  artifact: Artifact;
}

function dataUrlToText(dataUrl: string): string {
  if (!/^data:[^,]*;base64,/i.test(dataUrl)) return dataUrl;
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
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

    loadArtifactDataUrl(artifact.filePath)
      .then(dataUrl => {
        if (cancelled) return;
        setContent(dataUrlToText(dataUrl));
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
  }, [artifact.content, artifact.filePath]);

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
