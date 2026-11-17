import {
  MultiFileDiff,
  useWorkerPool,
  Virtualizer,
  WorkerPoolContextProvider,
} from '@pierre/diffs/react';
import React, { useContext, useEffect, useMemo } from 'react';

import {
  DIFF_HIGHLIGHTER_OPTIONS,
  DIFF_WORKER_POOL_OPTIONS,
  DiffPoolBoundaryContext,
} from './DiffWorkerPoolProvider';

interface DiffPreviewCanvasProps {
  fileName: string;
  oldContent: string;
  newContent: string;
  themeType: 'light' | 'dark';
  fallback: React.ReactNode;
  onWorkerFailure: () => void;
}

const DiffPreviewCanvas: React.FC<DiffPreviewCanvasProps> = ({
  fileName,
  oldContent,
  newContent,
  themeType,
  fallback,
  onWorkerFailure,
}) => {
  const hasWorkerGlobal = typeof Worker !== 'undefined';
  const existingPool = useWorkerPool();
  const boundary = useContext(DiffPoolBoundaryContext);

  useEffect(() => {
    if (!hasWorkerGlobal) {
      onWorkerFailure();
      return;
    }
    if (boundary.inBoundary && existingPool == null && !boundary.workerFailed) {
      boundary.ensurePool();
    }
  }, [boundary, existingPool, hasWorkerGlobal, onWorkerFailure]);

  const poolOptions = useMemo(
    () => ({
      ...DIFF_WORKER_POOL_OPTIONS,
      workerFactory: () => {
        try {
          return new Worker(new URL('./diffWorker.ts', import.meta.url), { type: 'module' });
        } catch (error) {
          onWorkerFailure();
          throw error;
        }
      },
      onWorkerError: (event: ErrorEvent | Event) => {
        if (typeof (event as Event).preventDefault === 'function') {
          event.preventDefault();
        }
        onWorkerFailure();
      },
    }),
    [onWorkerFailure],
  );

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

  if (!hasWorkerGlobal) {
    return <>{fallback}</>;
  }

  const diffContent = (
    <Virtualizer className="max-h-80 overflow-auto">
      <MultiFileDiff oldFile={files.oldFile} newFile={files.newFile} options={options} />
    </Virtualizer>
  );

  // Inside a session-level DiffWorkerPoolProvider, reuse its shared WorkerPoolContext
  // instead of wrapping every card in a separate WorkerPoolContextProvider.
  if (boundary.inBoundary) {
    if (existingPool == null) {
      return <>{fallback}</>;
    }
    return diffContent;
  }

  // Standalone fallback (when DiffPreview is mounted outside SessionStage).
  if (existingPool != null) {
    return diffContent;
  }

  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={DIFF_HIGHLIGHTER_OPTIONS}
    >
      {diffContent}
    </WorkerPoolContextProvider>
  );
};

export default DiffPreviewCanvas;
