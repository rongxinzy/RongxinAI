import React from 'react';

import { Skeleton } from '@shared/components/ui/skeleton';

import type { Artifact } from '@/types/artifact';

// Renderers pull heavy runtimes (Prism/refractor, mermaid, KaTeX/CodeMirror
// via MarkdownContent, document preview libs), so each one is code-split and
// only loads when an artifact of that type is actually shown (issue #141).
const CodeRenderer = React.lazy(() => import('./renderers/CodeRenderer'));
const DocumentRenderer = React.lazy(() => import('./renderers/DocumentRenderer'));
const HtmlRenderer = React.lazy(() => import('./renderers/HtmlRenderer'));
const ImageRenderer = React.lazy(() => import('./renderers/ImageRenderer'));
const MarkdownRenderer = React.lazy(() => import('./renderers/MarkdownRenderer'));
const MermaidRenderer = React.lazy(() => import('./renderers/MermaidRenderer'));
const ModelRenderer = React.lazy(() => import('./renderers/ModelRenderer'));
const SvgRenderer = React.lazy(() => import('./renderers/SvgRenderer'));
const TextRenderer = React.lazy(() => import('./renderers/TextRenderer'));
const UnsupportedRenderer = React.lazy(() => import('./renderers/UnsupportedRenderer'));

/**
 * Size-stable placeholder shown while a renderer chunk loads. A softly
 * pulsing surface communicates "content is loading" without any layout
 * shift once the real renderer mounts.
 */
const rendererFallback = (
  <div className="h-full min-h-0 p-4" aria-busy="true">
    <Skeleton className="theme-scene-preview-loading h-full w-full" />
  </div>
);

interface ArtifactRendererProps {
  artifact: Artifact;
  sessionArtifacts?: Artifact[];
}

const ArtifactRenderer: React.FC<ArtifactRendererProps> = ({ artifact }) => {
  let renderer: React.ReactNode;
  switch (artifact.type) {
    case 'html':
      renderer = <HtmlRenderer artifact={artifact} />;
      break;
    case 'svg':
      renderer = <SvgRenderer artifact={artifact} />;
      break;
    case 'image':
      renderer = <ImageRenderer artifact={artifact} />;
      break;
    case 'mermaid':
      renderer = <MermaidRenderer artifact={artifact} />;
      break;
    case 'markdown':
      renderer = <MarkdownRenderer artifact={artifact} />;
      break;
    case 'text':
      renderer = <TextRenderer artifact={artifact} />;
      break;
    case 'document':
      renderer = <DocumentRenderer artifact={artifact} />;
      break;
    case 'model':
      renderer = <ModelRenderer artifact={artifact} />;
      break;
    case 'code':
      renderer = <CodeRenderer artifact={artifact} />;
      break;
    case 'unsupported':
      renderer = <UnsupportedRenderer artifact={artifact} />;
      break;
    default:
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Unsupported artifact type
        </div>
      );
  }
  return <React.Suspense fallback={rendererFallback}>{renderer}</React.Suspense>;
};

export default ArtifactRenderer;
