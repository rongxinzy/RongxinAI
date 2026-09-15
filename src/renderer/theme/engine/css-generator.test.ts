import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { allThemes } from '../themes';
import { generateAllThemesCSS } from './css-generator';

test('checked-in CSS exactly matches all registered theme plugins', () => {
  const checkedInCss = readFileSync(
    fileURLToPath(new URL('../css/themes.css', import.meta.url)),
    'utf8',
  ).replace(/\r\n?/g, '\n');
  expect(checkedInCss).toBe(generateAllThemesCSS(allThemes));
});
