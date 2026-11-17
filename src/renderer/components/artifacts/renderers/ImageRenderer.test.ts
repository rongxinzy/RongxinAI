// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import type { Artifact } from '../../../types/artifact';
import ImageRenderer from './ImageRenderer';
import { i18nService } from '../../../services/i18n';

afterEach(cleanup);
const image: Artifact = {
  id: 'image-1',
  messageId: 'm1',
  sessionId: 's1',
  title: 'Generated image',
  type: 'image',
  content: '',
  filePath: './chart #1.png',
  source: 'tool',
  role: 'deliverable',
  createdAt: 1,
};

test('path-backed images load without base64 content and retry with a fresh URL', () => {
  render(createElement(ImageRenderer, { artifact: image, cwd: '/work' }));
  const before = screen.getByRole('img');
  expect(before.getAttribute('src')).toContain('localfile:///work/chart%20%231.png?revision=');
  const oldSource = before.getAttribute('src');
  fireEvent.error(before);
  expect(screen.queryByRole('img')).toBeNull();
  expect(i18nService.t('artifactImageRetry')).not.toBe('artifactImageRetry');
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('artifactImageRetry') }));
  expect(screen.getByRole('img').getAttribute('src')).not.toBe(oldSource);
});

test('a failed image cannot poison the next selected artifact', () => {
  const { rerender } = render(createElement(ImageRenderer, { artifact: image, cwd: '/work' }));
  fireEvent.error(screen.getByRole('img'));
  rerender(
    createElement(ImageRenderer, {
      artifact: { ...image, id: 'image-2', title: 'Second image', filePath: 'second.png' },
      cwd: '/work',
    }),
  );
  expect(screen.getByRole('img', { name: 'Second image' })).toHaveAttribute(
    'src',
    'localfile:///work/second.png?revision=image-2-0-0',
  );
});
