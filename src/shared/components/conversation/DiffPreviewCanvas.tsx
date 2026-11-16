import { MultiFileDiff, Virtualizer, WorkerPoolContextProvider } from '@pierre/diffs/react';
import React, { useEffect, useMemo } from 'react';

const DIFF_WORKER_POOL_OPTIONS = {
  poolSize: 2,
  totalASTLRUCacheSize: 100,
};

const DIFF_HIGHLIGHTER_OPTIONS = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' } as const,
  tokenizeMaxLineLength: 2000,
  lineDiffType: 'word-alt' as const,
};

interface DiffPreviewCanvasProps {
  fileName: string;
  oldContent: string;
  newContent: string;
  themeType: 'light' | 'dark';
  onWorkerFailure: () => void;
}

const DiffPreviewCanvas: React.FC<DiffPreviewCanvasProps> = ({
  fileName,
  oldContent,
  newContent,
  themeType,
  onWorkerFailure,
}) => {
  const hasWorkerGlobal = typeof Worker !== 'undefined';

  useEffect(() => {
    if (!hasWorkerGlobal) {
      onWorkerFailure();
    }
  }, [hasWorkerGlobal, onWorkerFailure]);

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
    return null;
  }

  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={DIFF_HIGHLIGHTER_OPTIONS}
    >
      <Virtualizer className="max-h-80 overflow-auto">
        <MultiFileDiff oldFile={files.oldFile} newFile={files.newFile} options={options} />
      </Virtualizer>
    </WorkerPoolContextProvider>
  );
};

export default DiffPreviewCanvas;
