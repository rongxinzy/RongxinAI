import React from 'react';

import type { Artifact } from '@/types/artifact';

import CodeRenderer from './renderers/CodeRenderer';
import DocumentRenderer from './renderers/DocumentRenderer';
import HtmlRenderer from './renderers/HtmlRenderer';
import ImageRenderer from './renderers/ImageRenderer';
import MarkdownRenderer from './renderers/MarkdownRenderer';
import MermaidRenderer from './renderers/MermaidRenderer';
import SvgRenderer from './renderers/SvgRenderer';
import TextRenderer from './renderers/TextRenderer';

interface ArtifactRendererProps {
  artifact: Artifact;
  sessionArtifacts?: Artifact[];
}

const ArtifactRenderer: React.FC<ArtifactRendererProps> = ({ artifact }) => {
  switch (artifact.type) {
    case 'html':
      return <HtmlRenderer artifact={artifact} />;
    case 'svg':
      return <SvgRenderer artifact={artifact} />;
    case 'image':
      return <ImageRenderer artifact={artifact} />;
    case 'mermaid':
      return <MermaidRenderer artifact={artifact} />;
    case 'markdown':
      return <MarkdownRenderer artifact={artifact} />;
    case 'text':
      return <TextRenderer artifact={artifact} />;
    case 'document':
      return <DocumentRenderer artifact={artifact} />;
    case 'code':
      return <CodeRenderer artifact={artifact} />;
    default:
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Unsupported artifact type
        </div>
      );
  }
};

export default ArtifactRenderer;
