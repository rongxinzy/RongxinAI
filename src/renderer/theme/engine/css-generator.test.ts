import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { allThemes } from '../themes';
import { defineThemePlugins, themePlugins, validateTheme } from '../themes/plugins';
import { TOKEN_NAMES } from '../tokens/contract';
import { generateAllThemesCSS } from './css-generator';

test('checked-in CSS exactly matches all registered theme plugins', () => {
  const checkedInCss = readFileSync(
    fileURLToPath(new URL('../css/themes.css', import.meta.url)),
    'utf8',
  ).replace(/\r\n?/g, '\n');
  expect(checkedInCss).toBe(generateAllThemesCSS(allThemes));
  for (const { meta } of allThemes) {
    expect(checkedInCss).toContain(
      `[data-theme="${meta.id}"], [data-theme-preview="${meta.id}"] {`,
    );
  }
});

test('rejects incomplete, duplicate and unsafe theme definitions before generating CSS', () => {
  for (const theme of allThemes) {
    expect(Object.keys(theme.tokens)).toHaveLength(TOKEN_NAMES.length);
    expect(() => validateTheme(theme)).not.toThrow();
  }
  const plugin = themePlugins[0];
  const light = plugin.appearances.light;
  expect(() => validateTheme({ ...light, tokens: { ...light.tokens, primary: '' } })).toThrow();
  expect(() =>
    validateTheme({ ...light, tokens: { ...light.tokens, primary: 'red; } body { display:none' } }),
  ).toThrow();
  expect(() => defineThemePlugins([plugin, plugin])).toThrow();
  expect(() => defineThemePlugins([{ ...plugin, appearances: { light, dark: light } }])).toThrow();
});
