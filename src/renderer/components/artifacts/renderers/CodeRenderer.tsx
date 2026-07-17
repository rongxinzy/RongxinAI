import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

import type { Artifact } from '@/types/artifact';

const MAX_HIGHLIGHT_SIZE = 50_000;

function useIsDark() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

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
  const isDark = useIsDark();
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
      <div className="flex items-center justify-center h-full text-muted text-sm">No content</div>
    );
  }

  if (artifact.content.length > MAX_HIGHLIGHT_SIZE) {
    return (
      <div className="h-full overflow-auto">
        <pre
          className={`text-xs font-mono leading-relaxed p-4 m-0 whitespace-pre ${
            isDark ? 'bg-[#282c34] text-[#abb2bf]' : 'bg-[#f0f2f5] text-[#383a42]'
          }`}
        >
          {artifact.content}
        </pre>
      </div>
    );
  }

  const language = artifact.language || LANGUAGE_MAP[artifact.type] || 'text';
  const style = isDark ? oneDark : oneLight;
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
              fontSize: '13px',
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
