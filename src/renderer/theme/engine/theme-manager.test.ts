// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { ThemeManager } from './theme-manager';
import { removeStyles } from './style-injector';
import { allThemes } from '../themes';
import { classicLight } from '../themes/classic-light';
import { defineThemePlugins, THEME_PLUGIN_VERSION, validateTheme } from '../themes/plugins';
import { TOKEN_NAMES } from '../tokens/contract';

afterEach(() => {
  removeStyles();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.className = '';
  document.body.replaceChildren();
});

test('switches complete plugin values without replacing focused inputs or application state', async () => {
  const custom = {
    ...classicLight,
    meta: { ...classicLight.meta, id: 'test-paper' },
    tokens: {
      ...classicLight.tokens,
      primary: '#993322',
      'semantic-card': '#fff8ee',
      'style-font-sans': 'serif',
    },
  };
  const persist = vi.fn();
  const manager = new ThemeManager([...allThemes, custom], {
    storage: { get: () => null, set: persist },
  });
  const input = document.createElement('textarea');
  document.body.append(input);
  input.value = 'Keep my draft';
  input.focus();
  await manager.setTheme(custom.meta.id);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('Keep my draft');
  expect(document.documentElement.dataset.theme).toBe(custom.meta.id);
  expect(document.querySelectorAll('#zhiyuan-theme-styles')).toHaveLength(1);
  expect(document.querySelector('#zhiyuan-theme-styles')?.textContent).toContain('--card: #fff8ee');
  await manager.setTheme('classic-dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(document.querySelector('#zhiyuan-theme-styles')?.textContent).not.toContain('#fff8ee');
  expect(document.activeElement).toBe(input);
  expect(persist).toHaveBeenCalledTimes(2);
  await manager.setTheme('missing-plugin');
  expect(manager.getThemeId()).toBe('classic-dark');
});

test('rejects incomplete, duplicate and unsafe theme definitions before they reach CSS', () => {
  for (const theme of allThemes) {
    expect(Object.keys(theme.tokens)).toHaveLength(TOKEN_NAMES.length);
    expect(() => validateTheme(theme)).not.toThrow();
  }
  expect(() =>
    validateTheme({ ...classicLight, tokens: { ...classicLight.tokens, primary: '' } }),
  ).toThrow();
  expect(() =>
    validateTheme({
      ...classicLight,
      tokens: { ...classicLight.tokens, primary: 'red; } body { display:none' },
    }),
  ).toThrow();
  expect(() =>
    defineThemePlugins([
      {
        version: THEME_PLUGIN_VERSION,
        id: 'test',
        name: { zh: 'test', en: 'test' },
        appearances: { light: classicLight, dark: classicLight },
      },
    ]),
  ).toThrow();
});
