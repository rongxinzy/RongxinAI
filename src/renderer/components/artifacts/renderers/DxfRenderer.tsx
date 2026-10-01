import React, { useEffect, useState } from 'react';

import { loadArtifactDataUrl } from '@/services/artifactFileLoader';
import { i18nService } from '@/services/i18n';
import type { Artifact } from '@/types/artifact';

import { dxfPreviewToSvg, parseDxfPreview } from './dxfPreview';

const t = (key: string) => i18nService.t(key);

interface DxfRendererProps {
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

const DxfRenderer: React.FC<DxfRendererProps> = ({ artifact }) => {
  const [svg, setSvg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setSvg(null);

      try {
        let text = artifact.content;
        if (!text) {
          if (!artifact.filePath) throw new Error(t('artifactDocumentError'));
          text = dataUrlToText(await loadArtifactDataUrl(artifact.filePath));
        }
        const rendered = dxfPreviewToSvg(parseDxfPreview(text));
        if (cancelled) return;
        if (!rendered) {
          setError(t('artifactPreviewUnsupported'));
          return;
        }
        setSvg(rendered);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
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

  if (error || !svg) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {error || t('artifactPreviewUnsupported')}
      </div>
    );
  }

  return (
    <div
      className="flex h-full w-full items-center justify-center overflow-auto bg-background p-4 text-foreground"
      // DXF → SVG is generated from trusted local workspace files only.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

export default DxfRenderer;
