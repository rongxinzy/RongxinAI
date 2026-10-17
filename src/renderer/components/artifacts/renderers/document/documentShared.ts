import { useEffect, useState } from 'react';

import { loadArtifactDataUrl } from '@/services/artifactFileLoader';
import { i18nService } from '@/services/i18n';
import type { Artifact } from '@/types/artifact';

export const t = (key: string) => i18nService.t(key);

export interface PdfDocumentHandle {
  numPages: number;
  destroy: () => Promise<void>;
}

export async function destroyPdfDocument(
  pdfDoc: Pick<PdfDocumentHandle, 'destroy'> | null,
): Promise<void> {
  if (!pdfDoc) return;
  try {
    await pdfDoc.destroy();
  } catch {
    // Cleanup must not turn a renderer unmount into an application error.
  }
}

export function getExtension(name: string): string {
  const lastDot = name.lastIndexOf('.');
  return lastDot === -1 ? '' : name.slice(lastDot).toLowerCase();
}

export function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  if (!/^data:[^,]*;base64,/i.test(dataUrl)) {
    return new TextEncoder().encode(dataUrl).buffer;
  }
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function useFileContent(artifact: Artifact): {
  data: ArrayBuffer | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (artifact.content) {
        try {
          const buf = dataUrlToArrayBuffer(artifact.content);
          if (!cancelled) {
            setData(buf);
            setLoading(false);
          }
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : String(e));
            setLoading(false);
          }
        }
        return;
      }

      if (artifact.filePath) {
        try {
          const dataUrl = await loadArtifactDataUrl(artifact.filePath);
          if (cancelled) return;
          setData(dataUrlToArrayBuffer(dataUrl));
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        }
        setLoading(false);
        return;
      }

      setError('No content available');
      setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [artifact.content, artifact.filePath]);

  return { data, loading, error };
}
