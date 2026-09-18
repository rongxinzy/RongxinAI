import { prismTheme } from '../../../theme/syntax/prism';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff';
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';

import type { Artifact } from '@/types/artifact';

const MAX_HIGHLIGHT_SIZE = 50_000;

// Full Prism ships every language grammar; register only what artifacts commonly need.
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('sh', bash);
SyntaxHighlighter.registerLanguage('c', c);
SyntaxHighlighter.registerLanguage('cpp', cpp);
SyntaxHighlighter.registerLanguage('csharp', csharp);
SyntaxHighlighter.registerLanguage('cs', csharp);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('diff', diff);
SyntaxHighlighter.registerLanguage('docker', docker);
SyntaxHighlighter.registerLanguage('dockerfile', docker);
SyntaxHighlighter.registerLanguage('go', go);
SyntaxHighlighter.registerLanguage('java', java);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('js', javascript);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('jsx', jsx);
SyntaxHighlighter.registerLanguage('kotlin', kotlin);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('md', markdown);
SyntaxHighlighter.registerLanguage('markup', markup);
SyntaxHighlighter.registerLanguage('html', markup);
SyntaxHighlighter.registerLanguage('xml', markup);
SyntaxHighlighter.registerLanguage('svg', markup);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('py', python);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('ts', typescript);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('yml', yaml);

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
  const containerRef = useRef<HTMLDivElement>(null);
  const hScrollRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const syncing = useRef(false);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setContentWidth(el.scrollWidth);
    setViewportWidth(el.clientWidth);
  }, []);

  useEffect(() => {
    measure();
  }, [artifact.content, measure]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!containerRef.current) return;
      const hasHScroll = containerRef.current.scrollWidth > containerRef.current.clientWidth;
      if (!hasHScroll) return;

      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        containerRef.current.scrollLeft += e.deltaX || e.deltaY;
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const onContainerScroll = () => {
    if (syncing.current) return;
    syncing.current = true;
    if (hScrollRef.current && containerRef.current) {
      hScrollRef.current.scrollLeft = containerRef.current.scrollLeft;
    }
    syncing.current = false;
  };

  const onHScrollbarScroll = () => {
    if (syncing.current) return;
    syncing.current = true;
    if (containerRef.current && hScrollRef.current) {
      containerRef.current.scrollLeft = hScrollRef.current.scrollLeft;
    }
    syncing.current = false;
  };

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
          className={`text-xs font-mono leading-relaxed p-4 m-0 whitespace-pre ${
            'bg-editor-background text-editor-foreground'
          }`}
        >
          {artifact.content}
        </pre>
      </div>
    );
  }

  const language = artifact.language || LANGUAGE_MAP[artifact.type] || 'text';
  const style = prismTheme;
  const needsHScroll = contentWidth > viewportWidth;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Vertical scroll + hidden horizontal scroll */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
        onScroll={onContainerScroll}
      >
        <div style={{ minWidth: contentWidth || undefined, width: 'fit-content' }}>
          <SyntaxHighlighter
            language={language}
            style={style}
            showLineNumbers
            customStyle={{
              margin: 0,
              borderRadius: 0,
              fontSize: 'var(--zy-component-text-sm)',
              lineHeight: '1.5',
              overflow: 'visible',
            }}
          >
            {artifact.content}
          </SyntaxHighlighter>
        </div>
      </div>
      {/* Fixed horizontal scrollbar at bottom */}
      {needsHScroll && (
        <div
          ref={hScrollRef}
          className="shrink-0 overflow-x-auto overflow-y-hidden"
          onScroll={onHScrollbarScroll}
          style={{ height: '14px' }}
        >
          <div style={{ width: contentWidth, height: '1px' }} />
        </div>
      )}
    </div>
  );
};

export default CodeRenderer;
