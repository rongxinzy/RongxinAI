// @vitest-environment jsdom
import { createElement, createRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { Switch } from './switch';

vi.mock('motion/react', async importOriginal => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => true,
}));
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});

test('switch retains keyboard, read-only and disabled behavior with theme recipes', async () => {
  const user = userEvent.setup();
  const onCheckedChange = vi.fn();
  const ref = createRef<HTMLButtonElement>();
  const view = render(createElement(Switch, { 'aria-label': 'Power', ref, onCheckedChange }));
  const control = screen.getByRole('switch', { name: 'Power' });
  control.setPointerCapture = vi.fn();
  expect(ref.current).toBe(control);
  await user.click(control);
  expect(control).toHaveAttribute('aria-checked', 'true');
  await user.keyboard(' ');
  expect(control).toHaveAttribute('aria-checked', 'false');
  expect(onCheckedChange).toHaveBeenCalledTimes(2);
  view.rerender(createElement(Switch, { 'aria-label': 'Power', readOnly: true, onCheckedChange }));
  await user.click(control);
  expect(control).toHaveAttribute('aria-checked', 'false');
  view.rerender(createElement(Switch, { 'aria-label': 'Power', disabled: true, onCheckedChange }));
  fireEvent.click(control);
  expect(onCheckedChange).toHaveBeenCalledTimes(2);
});

test('switch remeasures theme geometry without replacing its node or checked state', async () => {
  const view = render(createElement(Switch, { 'aria-label': 'Power', defaultChecked: true }));
  const control = screen.getByRole('switch', { name: 'Power' });
  const thumb = control.querySelector<HTMLElement>('[data-slot="switch-thumb"]')!;
  Object.defineProperty(control, 'offsetWidth', { configurable: true, value: 44 });
  Object.defineProperty(control, 'offsetHeight', { configurable: true, value: 26 });
  control.style.setProperty('--zy-style-switch-thumb-size', '20px');
  control.style.setProperty('--zy-style-switch-thumb-offset', '2px');
  control.style.borderWidth = '1px';
  document.documentElement.setAttribute('data-theme', 'geometry-proof');
  await waitFor(() => expect(thumb.style.width).toBe('20px'));
  await waitFor(() => expect(thumb.style.transform).toContain('translateX(20px)'));
  expect(screen.getByRole('switch')).toBe(control);
  expect(control).toHaveAttribute('aria-checked', 'true');
  view.unmount();
});
