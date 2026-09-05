// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { expect, test, vi } from 'vitest';
import { AppearanceSettings } from './AppearanceSettings';
vi.mock('../../services/i18n', () => ({
  i18nService: { t: (key: string) => key, getLanguage: () => 'en' },
}));

test('previews every appearance from plugin tokens and preserves keyboard selection semantics', async () => {
  const change = vi.fn();
  render(
    createElement(AppearanceSettings, {
      appearance: 'system',
      styleId: 'codex',
      onAppearanceChange: change,
      onStyleChange: vi.fn(),
    }),
  );
  expect(screen.getByRole('button', { name: 'system' })).toHaveAttribute('aria-pressed', 'true');
  const dark = screen.getByRole('button', { name: 'dark' });
  dark.focus();
  await userEvent.setup().keyboard('{Enter}');
  expect(change).toHaveBeenCalledExactlyOnceWith('dark');
  expect(dark.querySelector('[style]')?.getAttribute('style')).toContain('--zy-background');
});
