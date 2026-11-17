import { cn } from '@shared/lib/utils';
import React, { Suspense, useCallback, useContext, useEffect, useState } from 'react';

import { DiffPoolBoundaryContext } from './DiffWorkerPoolProvider';

const MAX_DIFF_CHARS = 120_000;
const MAX_DIFF_LINES = 3_000;
const EXCERPT_CHARS = 4_000;

const LazyDiffPreviewCanvas = React.lazy(() => import('./DiffPreviewCanvas'));

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

const exceedsDiffBudget = (oldContent: string, newContent: string): boolean => {
  if (oldContent.length + newContent.length > MAX_DIFF_CHARS) return true;
  let lines = 1;
  for (const source of [oldContent, newContent]) {
    for (let i = 0; i < source.length; i += 1) {
      if (source.charCodeAt(i) === 10) {
        lines += 1;
        if (lines > MAX_DIFF_LINES) return true;
      }
    }
  }
  return false;
};

export interface DiffPreviewProps {
  fileName: string;
  oldContent: string;
  newContent: string;
  className?: string;
}

/**
 * Lazy-loaded Shiki code diff surface backed by `@pierre/diffs`'s native
 * `WorkerPoolContextProvider` and `Virtualizer`, with explicit size/failure
 * guards so oversized inputs or broken workers never block the main thread.
 */
export function DiffPreview({ fileName, oldContent, newContent, className }: DiffPreviewProps) {
  const themeType = useDocumentThemeType();
  const boundary = useContext(DiffPoolBoundaryContext);
  const [workerFailed, setWorkerFailed] = useState(false);
  const overBudget = exceedsDiffBudget(oldContent, newContent);

  const handleWorkerFailure = useCallback(() => {
    setWorkerFailed(true);
    if (boundary.inBoundary) {
      boundary.reportWorkerFailure();
    }
  }, [boundary]);

  const excerptSource = newContent || oldContent;
  const excerpt =
    excerptSource.length > EXCERPT_CHARS
      ? `${excerptSource.slice(0, EXCERPT_CHARS)}\n…`
      : excerptSource;

  const fallback = (
    <pre className="theme-conversation-code-fallback max-h-72 overflow-auto">{excerpt}</pre>
  );

  return (
    <div className={cn('theme-conversation-diff max-h-80 overflow-hidden', className)}>
      {overBudget || workerFailed || boundary.workerFailed ? (
        fallback
      ) : (
        <Suspense fallback={fallback}>
          <LazyDiffPreviewCanvas
            fileName={fileName}
            oldContent={oldContent}
            newContent={newContent}
            themeType={themeType}
            fallback={fallback}
            onWorkerFailure={handleWorkerFailure}
          />
        </Suspense>
      )}
    </div>
  );
}
