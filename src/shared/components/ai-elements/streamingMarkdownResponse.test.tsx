// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { clearResolvedLocalPathCache } from '../../../renderer/services/useResolvedLocalPath';
import { StreamingMarkdownResponse } from './streamingMarkdownResponse';

const installElectronMock = (resolvedPath: string | null) => {
  const resolveLocalPath = vi.fn(async () => ({ path: resolvedPath }));
  const openPath = vi.fn(async () => ({ success: true }));
  const showItemInFolder = vi.fn(async () => ({ success: true }));
  (window as { electron?: unknown }).electron = {
    shell: { resolveLocalPath, openPath, showItemInFolder },
  };
  return { resolveLocalPath, openPath, showItemInFolder };
};

const RESOLVED_PATH = '/work/proj/report.html';

afterEach(() => {
  delete (window as { electron?: unknown }).electron;
  clearResolvedLocalPathCache();
  vi.restoreAllMocks();
});

describe('StreamingMarkdownResponse local paths', () => {
  test('inline code resolving to an existing file becomes a button that calls openPath', async () => {
    const { resolveLocalPath, openPath } = installElectronMock(RESOLVED_PATH);

    render(
      <StreamingMarkdownResponse
        content={'已生成报告：`report.html`，请查看。'}
        isStreaming={false}
        cwd="/work/proj"
      />,
    );

    await waitFor(() => {
      expect(resolveLocalPath).toHaveBeenCalledWith('report.html', '/work/proj');
    });
    const button = await screen.findByTitle(RESOLVED_PATH);
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('data-local-path', RESOLVED_PATH);

    fireEvent.click(button);
    await waitFor(() => expect(openPath).toHaveBeenCalledWith(RESOLVED_PATH));
  });

  test('unresolved inline code stays a plain code element without IPC clicks', async () => {
    const { resolveLocalPath, openPath } = installElectronMock(null);

    render(
      <StreamingMarkdownResponse
        content={'未找到：`missing.txt`'}
        isStreaming={false}
        cwd="/work"
      />,
    );

    await waitFor(() => expect(resolveLocalPath).toHaveBeenCalled());
    // Settled render: no clickable local-path button exists.
    await waitFor(() => {
      expect(screen.queryByTitle('/work/missing.txt')).toBeNull();
      expect(document.querySelector('[data-local-path]')).toBeNull();
    });
    const code = document.querySelector('code');
    expect(code).not.toBeNull();
    expect(code?.closest('button')).toBeNull();
    expect(openPath).not.toHaveBeenCalled();
  });

  test('plain prose filenames are never rewritten into links', () => {
    const { resolveLocalPath } = installElectronMock(RESOLVED_PATH);

    render(
      <StreamingMarkdownResponse
        content={'请打开 report.html 查看'}
        isStreaming={false}
        cwd="/work"
      />,
    );

    expect(resolveLocalPath).not.toHaveBeenCalled();
    expect(document.querySelector('[data-local-path]')).toBeNull();
    expect(document.querySelector('a')).toBeNull();
  });

  test('committed blocks during streaming do not trigger the resolve IPC', () => {
    const { resolveLocalPath } = installElectronMock(RESOLVED_PATH);

    const { rerender } = render(
      <StreamingMarkdownResponse
        content={'已生成报告：`report.html`\n\n正在继续输出…'}
        isStreaming
        cwd="/work/proj"
      />,
    );
    // While streaming, even the committed (closed) block must not probe.
    expect(resolveLocalPath).not.toHaveBeenCalled();
    expect(document.querySelector('[data-local-path]')).toBeNull();

    // Stream ends: the same content now resolves and becomes clickable.
    rerender(
      <StreamingMarkdownResponse
        content={'已生成报告：`report.html`\n\n正在继续输出…'}
        isStreaming={false}
        cwd="/work/proj"
      />,
    );
    expect(resolveLocalPath).toHaveBeenCalledWith('report.html', '/work/proj');
  });

  test('markdown links to local files resolve and open; external links untouched', async () => {
    const { resolveLocalPath, openPath } = installElectronMock(RESOLVED_PATH);

    render(
      <StreamingMarkdownResponse
        content={'[报告](./report.html) 与 [官网](https://example.com)'}
        isStreaming={false}
        cwd="/work/proj"
      />,
    );

    await waitFor(() => expect(resolveLocalPath).toHaveBeenCalledTimes(1));
    // Streamdown normalizes the "./" prefix away when exposing the href.
    expect(resolveLocalPath).toHaveBeenCalledWith('/report.html', '/work/proj');

    const button = await screen.findByTitle(RESOLVED_PATH);
    fireEvent.click(button);
    await waitFor(() => expect(openPath).toHaveBeenCalledWith(RESOLVED_PATH));
  });
});

describe('StreamingMarkdownResponse rendering stability', () => {
  test('keeps reference-style text consistent between streaming and final rendering', () => {
    const padding = 'context paragraph\n\n'.repeat(600);
    const content = `[label][ref]\n\n${padding}[ref]: https://example.com\n\n${padding}`;
    const { container, rerender } = render(
      <StreamingMarkdownResponse content={content} isStreaming />,
    );
    const streamed = container.textContent;

    rerender(<StreamingMarkdownResponse content={content} isStreaming={false} />);
    expect(container.textContent).toBe(streamed);
  });

  test('coalesces large tail layout updates but applies rewrites immediately', () => {
    vi.useFakeTimers();
    try {
      const initial = 'word 🚀 '.repeat(6_000);
      const { container, rerender } = render(
        <StreamingMarkdownResponse content={initial} isStreaming />,
        { wrapper: StrictMode },
      );
      const tail = container.querySelector('.whitespace-pre-wrap');
      const appended = `${initial}next`;
      rerender(<StreamingMarkdownResponse content={appended} isStreaming />);
      expect(tail?.textContent).toBe(initial);
      act(() => vi.advanceTimersByTime(48));
      expect(tail?.textContent).toBe(appended);

      const rewritten = 'rewritten '.repeat(4_000);
      rerender(<StreamingMarkdownResponse content={rewritten} isStreaming />);
      expect(tail?.textContent).toBe(rewritten);
    } finally {
      vi.useRealTimers();
    }
  });
});
