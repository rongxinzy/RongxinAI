import React, { useEffect, useState } from 'react';

import { loadArtifactDataUrl } from '@/services/artifactFileLoader';
import type { Artifact } from '@/types/artifact';

interface HtmlRendererProps {
  artifact: Artifact;
}

function hasRelativeResources(html: string): boolean {
  const srcRe = /(?:src|href)=["'](?!https?:|data:|blob:|#|javascript:)([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = srcRe.exec(html)) !== null) {
    const value = match[1];
    // Relative paths: ./file, ../file, file (no protocol)
    if (
      value.startsWith('./') ||
      value.startsWith('../') ||
      (!value.startsWith('/') && !value.includes(':'))
    ) {
      return true;
    }
    // Absolute paths to local source files (e.g., /src/main.jsx)
    if (value.startsWith('/') && !value.startsWith('//')) {
      return true;
    }
  }
  return false;
}

// 2026/09/17 lixiang  阻断应用深色 color-scheme 渗入 srcDoc，避免简历等浅底页白字不可见
export function ensurePreviewColorScheme(html: string): string {
  if (/name\s*=\s*["']color-scheme["']/i.test(html) || /color-scheme\s*:/i.test(html)) {
    return html;
  }
  const inject =
    '<meta name="color-scheme" content="light">' +
    '<style data-xiaoruan-preview-color-scheme>:root{color-scheme:light;}</style>';
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1${inject}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, `$1<head>${inject}</head>`);
  }
  return `<!DOCTYPE html><html><head>${inject}</head><body>${html}</body></html>`;
}

const HtmlRenderer: React.FC<HtmlRendererProps> = ({ artifact }) => {
  const [processedHtml, setProcessedHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!artifact.content && !artifact.filePath) {
      setProcessedHtml(null);
      return;
    }

    let cancelled = false;

    const process = async () => {
      try {
        let html = artifact.content;

        // If content is empty but filePath exists, read file directly
        if (!html && artifact.filePath) {
          const result = await loadArtifactDataUrl(artifact.filePath);
          if (cancelled) return;
          try {
            const base64 = result.split(',')[1] || '';
            const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            html = new TextDecoder('utf-8').decode(bytes);
          } catch {
            if (!cancelled) setProcessedHtml(null);
            return;
          }
        }

        if (!html) {
          if (!cancelled) setProcessedHtml(null);
          return;
        }

        if (artifact.filePath && !hasRelativeResources(html)) {
          html = await inlineLocalResources(html, artifact.filePath);
        }
        if (!cancelled) setProcessedHtml(ensurePreviewColorScheme(html));
      } catch {
        if (!cancelled) {
          setProcessedHtml(
            artifact.content ? ensurePreviewColorScheme(artifact.content) : null,
          );
        }
      }
    };

    process();
    return () => {
      cancelled = true;
    };
  }, [artifact.content, artifact.filePath]);

  if (!artifact.content && !artifact.filePath) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  // Content with relative resources and a filePath: inline resources not possible,
  // render via srcDoc with a <base> tag so relative URLs resolve
  if (artifact.filePath && artifact.content && hasRelativeResources(artifact.content)) {
    const dirPath = artifact.filePath.slice(0, artifact.filePath.lastIndexOf('/') + 1);
    const baseTag = `<base href="file://${dirPath}">`;
    const htmlWithBase = ensurePreviewColorScheme(
      artifact.content.replace(/(<head[^>]*>)/i, `$1${baseTag}`),
    );
    return (
      <iframe
        srcDoc={htmlWithBase}
        className="w-full h-full border-0"
        style={{ colorScheme: 'light' }}
        sandbox="allow-scripts allow-same-origin"
        title={artifact.title}
      />
    );
  }

  // Loading state: filePath exists but content not yet processed
  if (!processedHtml && !artifact.content) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  // Self-contained HTML (no relative resources): use srcDoc
  return (
    <iframe
      srcDoc={processedHtml || ensurePreviewColorScheme(artifact.content)}
      className="w-full h-full border-0"
      style={{ colorScheme: 'light' }}
      sandbox="allow-scripts"
      title={artifact.title}
    />
  );
};

function resolveRelativePath(src: string, htmlDir: string): string | null {
  if (
    !src ||
    src.startsWith('http://') ||
    src.startsWith('https://') ||
    src.startsWith('data:') ||
    src.startsWith('blob:')
  ) {
    return null;
  }
  return src.startsWith('/') ? src : htmlDir + src;
}

async function inlineLocalResources(html: string, filePath: string): Promise<string> {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastSlash <= 0) return html;
  const dir = filePath.slice(0, lastSlash + 1);

  const srcAttrs = /(?:src|data)=["']([^"']+)["']/gi;
  const matches = [...html.matchAll(srcAttrs)];
  const replacements: Array<[string, string]> = [];

  for (const match of matches) {
    const originalSrc = match[1];
    const absPath = resolveRelativePath(originalSrc, dir);
    if (!absPath) continue;

    try {
      const dataUrl = await loadArtifactDataUrl(absPath);
      replacements.push([originalSrc, dataUrl]);
    } catch {
      // Missing local resources are left untouched for the iframe to resolve.
    }
  }

  let result = html;
  for (const [original, replacement] of replacements) {
    result = result.split(original).join(replacement);
  }

  return result;
}

export default HtmlRenderer;
