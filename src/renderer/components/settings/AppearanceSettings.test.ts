// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { themePlugins } from '../../theme/themes/plugins';
import { AppearanceSettings } from './AppearanceSettings';
vi.mock('../../services/i18n', () => ({
  i18nService: { t: (key: string) => key, getLanguage: () => 'en' },
}));
afterEach(() => vi.unstubAllGlobals());

function systemAppearance() {
  const events = new EventTarget();
  const query = {
    matches: false,
    addEventListener: vi.fn(events.addEventListener.bind(events)),
    removeEventListener: vi.fn(events.removeEventListener.bind(events)),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => query));
  return {
    query,
    change(dark: boolean) {
      act(() => { query.matches = dark; events.dispatchEvent(new Event('change')); });
    },
  };
}

const props = () => ({
  appearance: 'light' as const,
  styleId: 'codex',
  onAppearanceChange: vi.fn(),
  onStyleChange: vi.fn(),
});

test('shows one preview per theme and keeps mode controls separate from theme selection', async () => {
  systemAppearance();
  const callbacks = props();
  const view = render(createElement(AppearanceSettings, callbacks));
  expect(view.container.querySelectorAll('[data-theme-preview]')).toHaveLength(themePlugins.length);
  expect(screen.getByRole('button', { name: 'Codex' })).toHaveAttribute('aria-pressed', 'true');
  const daming = screen.getByRole('button', { name: 'Daming Fenghua' });
  daming.focus();
  await userEvent.setup().keyboard('{Enter}');
  expect(callbacks.onStyleChange).toHaveBeenCalledExactlyOnceWith('daming');
  expect(callbacks.onAppearanceChange).not.toHaveBeenCalled();
  expect(screen.getByRole('tablist', { name: 'appearanceMode' }).querySelector('[data-theme-preview]')).toBeNull();
  await userEvent.setup().click(screen.getByRole('tab', { name: 'dark' }));
  expect(callbacks.onAppearanceChange).toHaveBeenCalledWith('dark');
  view.rerender(createElement(AppearanceSettings, { ...callbacks, appearance: 'dark', styleId: 'daming' }));
  expect(view.container.querySelector('[data-theme-preview="classic-dark"]')).not.toBeNull();
  expect(view.container.querySelector('[data-theme-preview="daming-dark"]')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Daming Fenghua' })).toBe(daming);
  expect(daming).toHaveAttribute('aria-pressed', 'true');
});

test('system mode updates all previews live while explicit mode stays fixed and listener is cleaned up', () => {
  const system = systemAppearance();
  const callbacks = props();
  const view = render(createElement(AppearanceSettings, { ...callbacks, appearance: 'system' }));
  const previews = () => Array.from(view.container.querySelectorAll('[data-theme-preview]'), e => e.getAttribute('data-theme-preview'));
  expect(previews()).toEqual(themePlugins.map(p => p.appearances.light.meta.id));
  system.change(true);
  expect(previews()).toEqual(themePlugins.map(p => p.appearances.dark.meta.id));
  expect(callbacks.onAppearanceChange).not.toHaveBeenCalled();
  view.rerender(createElement(AppearanceSettings, callbacks));
  expect(previews()).toEqual(themePlugins.map(p => p.appearances.light.meta.id));
  system.change(false);
  system.change(true);
  expect(previews()).toEqual(themePlugins.map(p => p.appearances.light.meta.id));
  view.unmount();
  expect(system.query.removeEventListener).toHaveBeenCalled();
});
