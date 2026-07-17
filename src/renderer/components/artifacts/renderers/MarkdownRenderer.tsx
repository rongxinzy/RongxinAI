import React from 'react';

import MarkdownContent from '@/components/MarkdownContent';
import type { Artifact } from '@/types/artifact';

interface MarkdownRendererProps {
  artifact: Artifact;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ artifact }) => {
  if (!artifact.content) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm">No content</div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <MarkdownContent content={artifact.content} />
    </div>
  );
};

export default MarkdownRenderer;
