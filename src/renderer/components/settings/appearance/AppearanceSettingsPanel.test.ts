// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { themePlugins } from '../../../theme/themes/plugins';
import { AppearanceSettingsPanel } from './AppearanceSettingsPanel';
vi.mock('../../../services/i18n', () => ({
  i18nService: { t: (key: string) => key, getLanguage: () => 'en' },
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function systemAppearance() {
  const events = new EventTarget();
  const query = {
    matches: false,
    addEventListener: vi.fn(events.addEventListener.bind(events)),
    removeEventListener: vi.fn(events.removeEventListener.bind(events)),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  );
  return {
    query,
    change(dark: boolean) {
      act(() => {
        query.matches = dark;
        events.dispatchEvent(new Event('change'));
      });
    },
  };
}

const props = () => ({
  appearance: 'light' as const,
  styleId: 'zenith',
  onAppearanceChange: vi.fn(),
  onStyleChange: vi.fn(),
});

test('shows one preview per theme and keeps mode controls separate from theme selection', async () => {
  systemAppearance();
  const callbacks = props();
  const view = render(createElement(AppearanceSettingsPanel, callbacks));
  expect(view.container.querySelectorAll('[data-theme-preview]')).toHaveLength(themePlugins.length);
  expect(screen.getByRole('button', { name: /Zenith/i })).toHaveAttribute('aria-pressed', 'true');
  // With only one theme, changing theme is not possible - test mode switching instead
  await userEvent.setup().click(screen.getByRole('tab', { name: 'dark' }));
  expect(callbacks.onAppearanceChange).toHaveBeenCalledWith('dark');
  expect(callbacks.onStyleChange).not.toHaveBeenCalled();
  expect(
    screen.getByRole('tablist', { name: 'appearanceMode' }).querySelector('[data-theme-preview]'),
  ).toBeNull();
  view.rerender(
    createElement(AppearanceSettingsPanel, { ...callbacks, appearance: 'dark', styleId: 'zenith' }),
  );
  // Previews follow the active appearance: dark mode renders the dark variant only.
  expect(view.container.querySelector('[data-theme-preview="zenith-dark"]')).not.toBeNull();
  expect(view.container.querySelector('[data-theme-preview="zenith-light"]')).toBeNull();
  expect(screen.getByRole('button', { name: /Zenith/i })).toHaveAttribute('aria-pressed', 'true');
});

test('shows an applying spinner on the selected style before the change runs', () => {
  vi.useFakeTimers();
  systemAppearance();
  // Persisted style id from a removed theme: Zenith is not yet applied, so clicking it runs a change.
  const callbacks = { ...props(), styleId: 'removed-legacy-theme' };
  const view = render(createElement(AppearanceSettingsPanel, callbacks));
  const zenith = screen.getByRole('button', { name: /Zenith/i });
  expect(zenith).toHaveAttribute('aria-pressed', 'false');

  act(() => {
    fireEvent.click(zenith);
  });

  expect(callbacks.onStyleChange).not.toHaveBeenCalled();
  expect(zenith).toHaveAttribute('aria-busy', 'true');
  expect(zenith).toHaveAttribute('aria-pressed', 'true');
  expect(zenith.querySelector('[data-slot="spinner"]')).toBeTruthy();

  act(() => {
    vi.runAllTimers();
  });

  expect(callbacks.onStyleChange).toHaveBeenCalledExactlyOnceWith('zenith');
  // pending 等到 styleId 同步后才清，避免转圈结束与高亮之间空窗
  expect(zenith).toHaveAttribute('aria-busy', 'true');
  expect(zenith).toHaveAttribute('aria-pressed', 'true');

  view.rerender(createElement(AppearanceSettingsPanel, { ...callbacks, styleId: 'zenith' }));
  expect(zenith).not.toHaveAttribute('aria-busy');
  expect(zenith).toHaveAttribute('aria-pressed', 'true');
});

test('clicking the already active style is a no-op', () => {
  vi.useFakeTimers();
  systemAppearance();
  const callbacks = props();
  render(createElement(AppearanceSettingsPanel, callbacks));
  const zenith = screen.getByRole('button', { name: /Zenith/i });
  act(() => {
    fireEvent.click(zenith);
    vi.runAllTimers();
  });
  expect(callbacks.onStyleChange).not.toHaveBeenCalled();
  expect(zenith).not.toHaveAttribute('aria-busy');
});

test('system mode updates all previews live while explicit mode stays fixed and listener is cleaned up', () => {
  const system = systemAppearance();
  const callbacks = props();
  const view = render(
    createElement(AppearanceSettingsPanel, { ...callbacks, appearance: 'system' }),
  );
  const previews = () =>
    Array.from(view.container.querySelectorAll('[data-theme-preview]'), e =>
      e.getAttribute('data-theme-preview'),
    );
  expect(previews()).toEqual(themePlugins.map(p => p.appearances.light.meta.id));
  system.change(true);
  expect(previews()).toEqual(themePlugins.map(p => p.appearances.dark.meta.id));
  expect(callbacks.onAppearanceChange).not.toHaveBeenCalled();
  view.rerender(createElement(AppearanceSettingsPanel, callbacks));
  expect(previews()).toEqual(themePlugins.map(p => p.appearances.light.meta.id));
  system.change(false);
  system.change(true);
  expect(previews()).toEqual(themePlugins.map(p => p.appearances.light.meta.id));
  view.unmount();
  expect(system.query.removeEventListener).toHaveBeenCalled();
});
