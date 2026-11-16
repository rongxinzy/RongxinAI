// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { clearResolvedLocalPathCache } from '../../../renderer/services/useResolvedLocalPath';
import { StreamingMarkdownResponse } from './streamingMarkdownResponse';

afterEach(() => {
  cleanup();
  clearResolvedLocalPathCache();
  vi.unstubAllGlobals();
});

function installResolver(path = '/work/chart #1.png') {
  const resolveLocalPath = vi.fn(async () => ({ path }));
  Object.assign(window, { electron: { shell: { resolveLocalPath } } });
  return resolveLocalPath;
}

test.each([
  ['file:///work/chart%20%231.png', '/work/chart #1.png'],
  ['/work/chart%20%231.png', '/work/chart #1.png'],
  ['./chart.png', '/chart.png'],
  ['C:/work/chart.png', 'C:/work/chart.png'],
  ['file:///work/chart%2520.png', '/work/chart%20.png'],
])('local image %s resolves through main and opens the shared preview', async (path, candidate) => {
  const resolve = installResolver();
  render(
    createElement(StreamingMarkdownResponse, {
      content: `![Generated chart](${path})`,
      isStreaming: false,
      cwd: '/work',
    }),
  );
  const image = await screen.findByRole('img', { name: 'Generated chart' });
  expect(resolve).toHaveBeenCalledWith(candidate, '/work');
  expect(image).toHaveAttribute('src', 'localfile:///work/chart%20%231.png');
  fireEvent.click(screen.getByRole('button', { name: 'Generated chart' }));
  expect(screen.getByRole('dialog', { name: 'Generated chart' })).toBeVisible();
});

test('streaming local image waits for settlement; remote images keep their original URL', async () => {
  const resolve = installResolver();
  const content = '![Generated chart](file:///work/chart.png)';
  const { rerender } = render(
    createElement(StreamingMarkdownResponse, { content, isStreaming: true, cwd: '/work' }),
  );
  expect(resolve).not.toHaveBeenCalled();
  expect(screen.queryByRole('img')).toBeNull();
  rerender(createElement(StreamingMarkdownResponse, { content, isStreaming: false, cwd: '/work' }));
  await screen.findByRole('img');
  resolve.mockClear();
  rerender(
    createElement(StreamingMarkdownResponse, {
      content: '![Remote](https://images.example.com/image.png)',
      isStreaming: false,
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole('img', { name: 'Remote' })).toHaveAttribute(
      'src',
      'https://images.example.com/image.png',
    ),
  );
  expect(resolve).not.toHaveBeenCalled();
});

test('image normalization preserves sanitization of executable protocols and raw scripts', () => {
  const resolve = installResolver();
  const { container } = render(
    createElement(StreamingMarkdownResponse, {
      content: '<script>alert(1)</script>\n\n![Unsafe](javascript:alert(1))',
      isStreaming: false,
    }),
  );
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('img[src^="javascript:"]')).toBeNull();
  expect(resolve).not.toHaveBeenCalled();
});
