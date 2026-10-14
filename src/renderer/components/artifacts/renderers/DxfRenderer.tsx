import React, { useEffect, useState } from 'react';

import { loadArtifactFile } from '@/services/artifactFileLoader';
import { i18nService } from '@/services/i18n';
import type { Artifact } from '@/types/artifact';

import { MAX_PREVIEW_DXF_CHARS } from './constants';
import { dxfPreviewToSvg, parseDxfPreview, sanitizeDxfSvg } from './dxfPreview';
import type { DxfPreviewWorkerResponse } from './dxfPreview.worker';

const t = (key: string) => i18nService.t(key);

interface DxfRendererProps {
  artifact: Artifact;
}

const DxfRenderer: React.FC<DxfRendererProps> = ({ artifact }) => {
  const [svg, setSvg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [oversized, setOversized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let activeWorker: Worker | null = null;

    const load = async () => {
      setLoading(true);
      setError(null);
      setSvg(null);
      setOversized(false);

      try {
        let text = artifact.content;
        if (!text) {
          if (!artifact.filePath) throw new Error(t('artifactDocumentError'));
          const loaded = await loadArtifactFile(artifact);
          text = loaded?.content ?? '';
        }

        if (text.length > MAX_PREVIEW_DXF_CHARS) {
          if (!cancelled) {
            setOversized(true);
            setLoading(false);
          }
          return;
        }

        const generateSvg = (): Promise<string | null> => {
          if (typeof window !== 'undefined' && typeof window.Worker === 'function') {
            return new Promise(resolve => {
              try {
                const worker = new Worker(new URL('./dxfPreview.worker.ts', import.meta.url), {
                  type: 'module',
                });
                activeWorker = worker;
                worker.onmessage = (event: MessageEvent<DxfPreviewWorkerResponse>) => {
                  worker.terminate();
                  if (activeWorker === worker) activeWorker = null;
                  resolve(event.data.svg);
                };
                worker.onerror = () => {
                  worker.terminate();
                  if (activeWorker === worker) activeWorker = null;
                  resolve(dxfPreviewToSvg(parseDxfPreview(text)));
                };
                worker.postMessage({ text });
              } catch {
                resolve(dxfPreviewToSvg(parseDxfPreview(text)));
              }
            });
          }
          return Promise.resolve(dxfPreviewToSvg(parseDxfPreview(text)));
        };

        const rendered = await generateSvg();
        if (cancelled) return;
        if (!rendered) {
          setError(t('artifactPreviewUnsupported'));
          return;
        }

        const sanitized = sanitizeDxfSvg(rendered);
        if (cancelled) return;
        setSvg(sanitized);
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
      if (activeWorker) {
        activeWorker.terminate();
        activeWorker = null;
      }
    };
  }, [artifact]);

  if (oversized || (artifact.content?.length ?? 0) > MAX_PREVIEW_DXF_CHARS) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        {t('artifactPreviewTooLarge')}
      </div>
    );
  }

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
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

export default DxfRenderer;
