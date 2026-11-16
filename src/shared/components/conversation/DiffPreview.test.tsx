// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  poolProps: [] as Array<{
    poolOptions: Record<string, unknown>;
    highlighterOptions: Record<string, unknown>;
  }>,
  multiFileProps: [] as Array<{
    oldFile: { name: string; contents: string };
    newFile: { name: string; contents: string };
  }>,
  virtualizerRendered: 0,
}));

vi.mock('@pierre/diffs/react', () => ({
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
    return <div data-testid="worker-pool-provider">{children}</div>;
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
}));

import { DiffPreview } from './DiffPreview';

afterEach(() => {
  captured.poolProps.length = 0;
  captured.multiFileProps.length = 0;
  captured.virtualizerRendered = 0;
  vi.unstubAllGlobals();
});

describe('DiffPreview', () => {
  test('renders WorkerPoolContextProvider and Virtualizer when Worker is available', async () => {
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
