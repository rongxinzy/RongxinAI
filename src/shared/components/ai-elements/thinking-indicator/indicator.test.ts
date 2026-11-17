// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { expect, test, vi } from 'vitest';

import { ThinkingIndicator } from './index';

vi.mock('thinking-orbs', () => ({
  ThinkingOrb: ({ color, theme }: { color: string; theme: string }) =>
    createElement('canvas', { 'data-ink': color, 'data-theme': theme }),
}));

test('updates the existing canvas ink after replacing a same-appearance theme stylesheet', async () => {
  const style = document.createElement('style');
  style.textContent = '.theme-thinking-indicator { color: rgb(83, 88, 98); }';
  document.head.appendChild(style);
  const view = render(createElement(ThinkingIndicator, { paused: true }));
  try {
    const canvas = view.container.querySelector('canvas');
    expect(canvas?.getAttribute('data-ink')).toBe('rgb(83, 88, 98)');
    await act(async () => {
      style.textContent = '.theme-thinking-indicator { color: rgb(179, 38, 30); }';
    });
    expect(view.container.querySelector('canvas')).toBe(canvas);
    await waitFor(() => expect(canvas?.getAttribute('data-ink')).toBe('rgb(179, 38, 30)'));
    await act(async () => {
      document.documentElement.classList.add('dark');
    });
    await waitFor(() => expect(canvas?.getAttribute('data-theme')).toBe('dark'));
  } finally {
    view.unmount();
    style.remove();
    document.documentElement.classList.remove('dark');
  }
});
