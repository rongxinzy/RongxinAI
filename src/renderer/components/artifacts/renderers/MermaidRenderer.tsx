import mermaid from 'mermaid';
import React, { useEffect, useRef, useState } from 'react';

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

interface MermaidRendererProps {
  artifact: Artifact;
}

const MermaidRenderer: React.FC<MermaidRendererProps> = ({ artifact }) => {
  const containerRef = useRef<HTMLDivElement>(null);
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

  if (error) {
    return (
      <div className="p-4 text-sm text-red-500">
        <p className="font-medium">Mermaid render error</p>
        <pre className="mt-2 text-xs whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-auto flex items-center justify-center p-4"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

export default MermaidRenderer;
