// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { clearResolvedLocalPathCache } from '../../services/useResolvedLocalPath';
import StaticMarkdownContent from './StaticMarkdownContent';

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

describe('StaticMarkdownContent', () => {
  test('renders GFM tables with headers and rows', () => {
    render(
      <StaticMarkdownContent
        content={'| 名称 | 状态 |\n| --- | --- |\n| 报告 | 完成 |'}
      />,
    );

    const table = document.querySelector('table');
    expect(table).not.toBeNull();
    expect(screen.getByText('名称')).toBeTruthy();
    expect(screen.getByText('状态')).toBeTruthy();
    expect(screen.getByText('报告')).toBeTruthy();
    expect(screen.getByText('完成')).toBeTruthy();
  });

  test('renders GFM task list checkboxes', () => {
    render(<StaticMarkdownContent content={'- [x] 已完成\n- [ ] 待办'} />);

    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    expect((checkboxes[0] as HTMLInputElement).disabled).toBe(true);
  });

  test('renders KaTeX math including mhchem equations', async () => {
    // $$ gates the rich runtime; wait for the lazy chunk to settle.
    render(
      <StaticMarkdownContent
        content={'$$\\ce{H2O <=> H+ + OH-}$$\n\n$$E = mc^2$$'}
      />,
    );

    // mhchem renders H2O as separate spans inside .katex-html; match the
    // whole rendered math container instead of raw text nodes.
    await waitFor(() => {
      expect(document.querySelectorAll('.katex').length).toBe(2);
    });
    expect(document.body.textContent).toContain('H2O');
    expect(document.body.textContent).toContain('mc');
  });

  test('renders inline math with single dollars', async () => {
    render(<StaticMarkdownContent content={'能量 $E = mc^2$ 守恒'} />);

    await waitFor(() => {
      expect(document.querySelector('.katex')).not.toBeNull();
    });
  });

  test('markdown link resolving to a local file becomes an openable link', async () => {
    const { resolveLocalPath, openPath } = installElectronMock(RESOLVED_PATH);

    render(
      <StaticMarkdownContent
        content={'[报告](./report.html) 与 [官网](https://example.com)'}
        cwd="/work/proj"
      />,
    );

    await waitFor(() => expect(resolveLocalPath).toHaveBeenCalled());
    const link = await screen.findByTitle(RESOLVED_PATH);
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('data-local-path', RESOLVED_PATH);

    fireEvent.click(link);
    await waitFor(() => expect(openPath).toHaveBeenCalledWith(RESOLVED_PATH));
  });

  test('file:// link destinations are stripped and still resolve as local paths', async () => {
    const { resolveLocalPath } = installElectronMock(RESOLVED_PATH);

    render(
      <StaticMarkdownContent
        content={'[报告](file:///work/proj/report.html)'}
        cwd="/work/proj"
      />,
    );

    await waitFor(() =>
      expect(resolveLocalPath).toHaveBeenCalledWith('/work/proj/report.html', '/work/proj'),
    );
    expect(await screen.findByTitle(RESOLVED_PATH)).toBeTruthy();
  });

  test('unresolved path-like links stay plain anchors without IPC clicks', async () => {
    const { resolveLocalPath, openPath } = installElectronMock(null);

    render(
      <StaticMarkdownContent content={'[丢失](missing.txt)'} cwd="/work" />,
    );

    await waitFor(() => expect(resolveLocalPath).toHaveBeenCalled());
    await waitFor(() => {
      expect(document.querySelector('[data-local-path]')).toBeNull();
    });
    expect(openPath).not.toHaveBeenCalled();
    const anchor = screen.getByText('丢失').closest('a');
    expect(anchor).not.toBeNull();
  });

  test('restrictLocalFileLinks degrades unresolved path-like links to plain text', async () => {
    installElectronMock(null);

    render(
      <StaticMarkdownContent
        content={'[丢失](missing.txt)'}
        cwd="/work"
        restrictLocalFileLinks
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText('丢失').closest('a')).toBeNull();
    });
    expect(screen.getByText('丢失').tagName).not.toBe('A');
  });

  test('external links keep their href and are not probed for local resolution', async () => {
    const { resolveLocalPath } = installElectronMock(RESOLVED_PATH);

    render(
      <StaticMarkdownContent
        content={'[官网](https://example.com) 与 [邮件](mailto:a@b.c)'}
        cwd="/work"
      />,
    );

    const external = screen.getByText('官网').closest('a');
    expect(external?.getAttribute('href')).toMatch(/^https:\/\/example\.com\/?$/);
    const mail = screen.getByText('邮件').closest('a');
    expect(mail).toHaveAttribute('href', 'mailto:a@b.c');
    await waitFor(() => {
      expect(document.querySelector('[data-local-path]')).toBeNull();
    });
    expect(resolveLocalPath).not.toHaveBeenCalled();
  });

  test('fenced code blocks render with language header and copy button', async () => {
    render(
      <StaticMarkdownContent
        content={'```python\nprint("hello")\n```'}
      />,
    );

    // AiPre code block header shows the normalized language id.
    expect(await screen.findByText('python')).toBeTruthy();
    const copyButton = screen
      .getAllByRole('button')
      .find(button => button.querySelector('svg'));
    expect(copyButton).toBeTruthy();
    const code = document.querySelector('pre code, pre');
    expect(code?.textContent).toContain('print("hello")');
  });

  test('plain prose never triggers local path resolution', () => {
    const { resolveLocalPath } = installElectronMock(RESOLVED_PATH);

    render(<StaticMarkdownContent content={'请打开 report.html 查看'} cwd="/work" />);

    expect(resolveLocalPath).not.toHaveBeenCalled();
    expect(document.querySelector('[data-local-path]')).toBeNull();
    expect(document.querySelector('a')).toBeNull();
  });

  test('local images are rewritten to the localfile protocol', () => {
    render(
      <StaticMarkdownContent
        content={'![截图](./screenshots/home.png)'}
        cwd="/work/proj"
      />,
    );

    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toContain('localfile://');
  });
});
