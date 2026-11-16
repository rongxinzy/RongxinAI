import { cn } from '@shared/lib/utils';
import React, { Suspense, useEffect, useMemo, useState } from 'react';

const LazyMultiFileDiff = React.lazy(async () => {
  const mod = await import('@pierre/diffs/react');
  return { default: mod.MultiFileDiff };
});

function useDocumentThemeType(): 'light' | 'dark' {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false,
  );

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark ? 'dark' : 'light';
}

export interface DiffPreviewProps {
  fileName: string;
  oldContent: string;
  newContent: string;
  className?: string;
}

/**
 * Lazy-loaded Shiki code diff surface powered by `@pierre/diffs`.
 * Kept dynamically imported so the diff/worker bundle stays out of initial app paint.
 */
export function DiffPreview({ fileName, oldContent, newContent, className }: DiffPreviewProps) {
  const themeType = useDocumentThemeType();
  const files = useMemo(
    () => ({
      oldFile: { name: fileName, contents: oldContent },
      newFile: { name: fileName, contents: newContent },
    }),
    [fileName, oldContent, newContent],
  );

  const options = useMemo(
    () => ({
      diffStyle: 'unified' as const,
      themeType,
      disableFileHeader: true,
      overflow: 'scroll' as const,
    }),
    [themeType],
  );

  const fallback = (
    <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs text-foreground">
      {newContent || oldContent}
    </pre>
  );

  return (
    <div
      className={cn(
        'max-h-80 overflow-auto rounded-md border border-border bg-background text-xs',
        className,
      )}
    >
      <Suspense fallback={fallback}>
        <LazyMultiFileDiff
          oldFile={files.oldFile}
          newFile={files.newFile}
          options={options}
          disableWorkerPool
        />
      </Suspense>
    </div>
  );
}
