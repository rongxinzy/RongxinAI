import mermaid from 'mermaid';
import { Button } from '@shared/components/ui/button';
import { Maximize2, Minimize2 } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { i18nService } from '@/services/i18n';
import type { Artifact } from '@/types/artifact';

let mermaidInitialized = false;

function initMermaid(isDark: boolean) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: isDark ? 'dark' : 'default',
  });
  mermaidInitialized = true;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.001;

interface MermaidRendererProps {
  artifact: Artifact;
}

const MermaidRenderer: React.FC<MermaidRendererProps> = ({ artifact }) => {
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string>('');

  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    if (!mermaidInitialized) {
      initMermaid(isDark);
    }

    let cancelled = false;
    const renderDiagram = async () => {
      try {
        const id = `mermaid-${artifact.id.replace(/[^a-zA-Z0-9]/g, '')}`;
        const { svg: rendered } = await mermaid.render(id, artifact.content);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
        }
      }
    };

    renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [artifact.content, artifact.id]);

  // Reset zoom whenever a different diagram renders, so switching artifacts
  // does not carry the previous scale over.
  useEffect(() => {
    setScale(1);
  }, [artifact.id]);

  useEffect(() => {
    const el = fullscreenRef.current;
    if (!el) return;
    // Native listener with { passive: false } so preventDefault actually works
    // (React's synthetic onWheel is passive, where preventDefault is a no-op).
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale(prev => Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev - e.deltaY * ZOOM_STEP)));
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === fullscreenRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const resetZoom = useCallback(() => setScale(1), []);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement === fullscreenRef.current) {
      try {
        await document.exitFullscreen();
      } catch {
        console.warn('[MermaidRenderer] exiting fullscreen failed');
      }
      return;
    }
    try {
      await fullscreenRef.current?.requestFullscreen();
    } catch {
      console.warn('[MermaidRenderer] entering fullscreen failed');
    }
  }, []);

  if (error) {
    return (
      <div className="p-4 text-sm text-red-500">
        <p className="font-medium">Mermaid render error</p>
        <pre className="mt-2 text-xs whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  return (
    <div ref={fullscreenRef} className="relative h-full w-full overflow-auto bg-background">
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
          className="min-w-0"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      {scale !== 1 && (
        <Button
          variant="secondary"
          size="sm"
          onClick={resetZoom}
          className="theme-page-mermaid-renderer-button-1 absolute bottom-3 right-3 z-10"
        >
          {Math.round(scale * 100)}%
        </Button>
      )}
      {document.fullscreenEnabled && (
        <Button
          variant="secondary"
          size="icon"
          onClick={() => void toggleFullscreen()}
          className="absolute right-3 top-3 z-10"
          title={i18nService.t(isFullscreen ? 'artifactExitFullscreen' : 'artifactEnterFullscreen')}
          aria-label={i18nService.t(
            isFullscreen ? 'artifactExitFullscreen' : 'artifactEnterFullscreen',
          )}
        >
          {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Button>
      )}
    </div>
  );
};

export default MermaidRenderer;
