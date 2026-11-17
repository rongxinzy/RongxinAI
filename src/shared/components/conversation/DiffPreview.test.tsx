// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  poolProps: [] as Array<{
    poolOptions: Record<string, unknown>;
    highlighterOptions: Record<string, unknown>;
  }>,
  singletonCalls: [] as Array<{
    poolOptions: Record<string, unknown>;
    highlighterOptions: Record<string, unknown>;
  }>,
  terminateCount: 0,
  multiFileProps: [] as Array<{
    oldFile: { name: string; contents: string };
    newFile: { name: string; contents: string };
  }>,
  virtualizerRendered: 0,
}));

vi.mock('@pierre/diffs/worker', () => ({
  getOrCreateWorkerPoolSingleton: (config: {
    poolOptions: Record<string, unknown>;
    highlighterOptions: Record<string, unknown>;
  }) => {
    captured.singletonCalls.push(config);
    return { mockManager: true };
  },
  terminateWorkerPoolSingleton: () => {
    captured.terminateCount += 1;
  },
}));

vi.mock('@pierre/diffs/react', async () => {
  const react = await import('react');
  const WorkerPoolContext = react.createContext<unknown>(undefined);
  return {
    WorkerPoolContext,
    useWorkerPool: () => react.useContext(WorkerPoolContext),
    WorkerPoolContextProvider: ({
      children,
      poolOptions,
      highlighterOptions,
    }: {
      children: React.ReactNode;
      poolOptions: Record<string, unknown>;
      highlighterOptions: Record<string, unknown>;
    }) => {
      captured.poolProps.push({ poolOptions, highlighterOptions });
      return (
        <WorkerPoolContext.Provider value={{ mockStandalone: true }}>
          <div data-testid="worker-pool-provider">{children}</div>
        </WorkerPoolContext.Provider>
      );
    },
    Virtualizer: ({ children, className }: { children: React.ReactNode; className?: string }) => {
      captured.virtualizerRendered += 1;
      return (
        <div data-testid="diff-virtualizer" className={className}>
          {children}
        </div>
      );
    },
    MultiFileDiff: ({
      oldFile,
      newFile,
    }: {
      oldFile: { name: string; contents: string };
      newFile: { name: string; contents: string };
    }) => {
      captured.multiFileProps.push({ oldFile, newFile });
      return <div data-testid="multi-file-diff">{newFile.name}</div>;
    },
  };
});

import { DiffPreview } from './DiffPreview';
import { DiffWorkerPoolProvider } from './DiffWorkerPoolProvider';

afterEach(() => {
  captured.poolProps.length = 0;
  captured.singletonCalls.length = 0;
  captured.terminateCount = 0;
  captured.multiFileProps.length = 0;
  captured.virtualizerRendered = 0;
  vi.unstubAllGlobals();
});

describe('DiffPreview', () => {
  test('renders WorkerPoolContextProvider and Virtualizer when mounted standalone', async () => {
    class MockWorker {
      addEventListener() {}
      removeEventListener() {}
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', MockWorker);

    render(
      <DiffPreview fileName="src/example.ts" oldContent="const a = 1;" newContent="const a = 2;" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('worker-pool-provider')).toBeTruthy();
    });
    expect(screen.getByTestId('diff-virtualizer')).toBeTruthy();
    expect(screen.getByTestId('multi-file-diff').textContent).toBe('src/example.ts');
    const latestPool = captured.poolProps.at(-1);
    expect(latestPool?.poolOptions.poolSize).toBe(2);
    expect(latestPool?.poolOptions.totalASTLRUCacheSize).toBe(100);
    expect(latestPool?.highlighterOptions.tokenizeMaxLineLength).toBe(2000);
  });

  test('shares a single session worker pool across multiple DiffPreview cards without per-card providers', async () => {
    class MockWorker {
      addEventListener() {}
      removeEventListener() {}
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', MockWorker);

    const view = render(
      <DiffWorkerPoolProvider>
        <DiffPreview fileName="src/one.ts" oldContent="1" newContent="2" />
        <DiffPreview fileName="src/two.ts" oldContent="a" newContent="b" />
      </DiffWorkerPoolProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId('multi-file-diff')).toHaveLength(2);
    });
    expect(screen.queryByTestId('worker-pool-provider')).toBeNull();
    expect(captured.poolProps).toHaveLength(0);
    expect(captured.singletonCalls).toHaveLength(1);
    expect(captured.singletonCalls[0].poolOptions.poolSize).toBe(2);

    const onWorkerError = captured.singletonCalls[0].poolOptions.onWorkerError as (
      e: Event,
    ) => void;
    act(() => {
      onWorkerError(new Event('error'));
    });

    await waitFor(() => {
      expect(screen.queryAllByTestId('multi-file-diff')).toHaveLength(0);
    });
    expect(document.querySelectorAll('.theme-conversation-code-fallback')).toHaveLength(2);

    view.unmount();
    expect(captured.terminateCount).toBe(1);
  });

  test('falls back to plain excerpt when diff exceeds character or line budget', () => {
    class MockWorker {
      addEventListener() {}
      removeEventListener() {}
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', MockWorker);

    const hugeChars = 'a'.repeat(120_005);
    const { rerender } = render(
      <DiffPreview fileName="big.txt" oldContent="" newContent={hugeChars} />,
    );
    expect(screen.queryByTestId('worker-pool-provider')).toBeNull();
    expect(document.querySelector('.theme-conversation-code-fallback')?.textContent).toContain('…');

    const manyLines = Array.from({ length: 3_005 }, (_, i) => `line ${i}`).join('\n');
    rerender(<DiffPreview fileName="many.txt" oldContent="" newContent={manyLines} />);
    expect(screen.queryByTestId('worker-pool-provider')).toBeNull();
    expect(document.querySelector('.theme-conversation-code-fallback')?.textContent).toContain(
      'line 0',
    );
  });

  test('switches to plain fallback when worker error fires without sync highlighting', async () => {
    class MockWorker {
      addEventListener() {}
      removeEventListener() {}
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', MockWorker);

    render(<DiffPreview fileName="src/app.ts" oldContent="old()" newContent="new()" />);

    await waitFor(() => {
      expect(captured.poolProps.length).toBeGreaterThan(0);
    });

    const onWorkerError = captured.poolProps[0].poolOptions.onWorkerError as (e: Event) => void;
    act(() => {
      onWorkerError(new Event('error'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('worker-pool-provider')).toBeNull();
    });
    expect(document.querySelector('.theme-conversation-code-fallback')?.textContent).toBe('new()');
  });
});
