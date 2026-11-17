import { WorkerPoolContext } from '@pierre/diffs/react';
import type { WorkerPoolManager } from '@pierre/diffs/worker';
import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const DIFF_WORKER_POOL_OPTIONS = {
  poolSize: 2,
  totalASTLRUCacheSize: 100,
};

export const DIFF_HIGHLIGHTER_OPTIONS = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' } as const,
  tokenizeMaxLineLength: 2000,
  lineDiffType: 'word-alt' as const,
};

export interface DiffPoolBoundaryState {
  inBoundary: boolean;
  workerFailed: boolean;
  ensurePool: () => void;
  reportWorkerFailure: () => void;
}

const DEFAULT_BOUNDARY: DiffPoolBoundaryState = {
  inBoundary: false,
  workerFailed: false,
  ensurePool: () => {},
  reportWorkerFailure: () => {},
};

export const DiffPoolBoundaryContext = createContext<DiffPoolBoundaryState>(DEFAULT_BOUNDARY);

let activeSessionPoolProviders = 0;

export function DiffWorkerPoolProvider({ children }: { children: React.ReactNode }) {
  const [poolManager, setPoolManager] = useState<WorkerPoolManager | undefined>(undefined);
  const [workerFailed, setWorkerFailed] = useState(false);
  const mountedRef = useRef(true);
  const acquiredRef = useRef(false);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const terminateWorkerPoolRef = useRef<(() => void) | null>(null);

  const reportWorkerFailure = useCallback(() => {
    if (mountedRef.current) {
      setWorkerFailed(true);
    }
  }, []);

  const ensurePool = useCallback(() => {
    if (workerFailed || poolManager || initPromiseRef.current) return;
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      reportWorkerFailure();
      return;
    }

    initPromiseRef.current = import('@pierre/diffs/worker')
      .then(({ getOrCreateWorkerPoolSingleton, terminateWorkerPoolSingleton }) => {
        terminateWorkerPoolRef.current = terminateWorkerPoolSingleton;
        if (!mountedRef.current) {
          initPromiseRef.current = null;
          return;
        }

        const manager = getOrCreateWorkerPoolSingleton({
          poolOptions: {
            ...DIFF_WORKER_POOL_OPTIONS,
            workerFactory: () => {
              try {
                return new Worker(new URL('./diffWorker.ts', import.meta.url), {
                  type: 'module',
                });
              } catch (error) {
                reportWorkerFailure();
                throw error;
              }
            },
            onWorkerError: (event: ErrorEvent | Event) => {
              if (typeof event.preventDefault === 'function') {
                event.preventDefault();
              }
              reportWorkerFailure();
            },
          },
          highlighterOptions: DIFF_HIGHLIGHTER_OPTIONS,
        });

        if (!acquiredRef.current) {
          acquiredRef.current = true;
          activeSessionPoolProviders += 1;
        }
        setPoolManager(manager);
      })
      .catch(() => {
        initPromiseRef.current = null;
        reportWorkerFailure();
      });
  }, [poolManager, reportWorkerFailure, workerFailed]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (acquiredRef.current) {
        acquiredRef.current = false;
        activeSessionPoolProviders = Math.max(0, activeSessionPoolProviders - 1);
        if (activeSessionPoolProviders === 0) {
          terminateWorkerPoolRef.current?.();
        }
      }
    };
  }, []);

  const boundaryValue = useMemo<DiffPoolBoundaryState>(
    () => ({
      inBoundary: true,
      workerFailed,
      ensurePool,
      reportWorkerFailure,
    }),
    [ensurePool, reportWorkerFailure, workerFailed],
  );

  return (
    <DiffPoolBoundaryContext.Provider value={boundaryValue}>
      <WorkerPoolContext.Provider value={poolManager}>{children}</WorkerPoolContext.Provider>
    </DiffPoolBoundaryContext.Provider>
  );
}
