import { CodeBlock } from '@shared/components/ai-elements/code-block';
import { normalizeCodeLanguage } from '@shared/components/ai-elements/code-block';
import React from 'react';

import type { Artifact } from '@/types/artifact';

const MAX_HIGHLIGHT_SIZE = 50_000;

const LANGUAGE_MAP: Record<string, string> = {
  html: 'html',
  svg: 'xml',
  mermaid: 'markdown',
  react: 'jsx',
  jsx: 'jsx',
  tsx: 'tsx',
};

interface CodeRendererProps {
  artifact: Artifact;
}

const CodeRenderer: React.FC<CodeRendererProps> = ({ artifact }) => {
  if (!artifact.content) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No content
      </div>
    );
  }

  if (artifact.content.length > MAX_HIGHLIGHT_SIZE) {
    return (
      <div className="h-full overflow-auto">
        <pre
          className={`text-xs font-mono leading-relaxed p-4 m-0 whitespace-pre ${'bg-editor-background text-editor-foreground'}`}
        >
          {artifact.content}
        </pre>
      </div>
    );
  }

  const rawLanguage = artifact.language || LANGUAGE_MAP[artifact.type] || 'text';
  const language = normalizeCodeLanguage(rawLanguage) ?? 'text';

  return (
    <div className="h-full overflow-auto">
      <CodeBlock
        code={artifact.content}
        language={language}
        showLineNumbers
        className="h-full rounded-none border-0"
      />
    </div>
  );
};

export default CodeRenderer;
