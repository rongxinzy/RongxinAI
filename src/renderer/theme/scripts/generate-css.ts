import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { generateAllThemesCSS } from '../engine/css-generator';
import { allThemes } from '../themes/index';

const css = generateAllThemesCSS(allThemes);
const outPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'css', 'themes.css');
if (process.argv.includes('--check')) {
  if (readFileSync(outPath, 'utf8') !== css)
    throw new Error('Generated theme CSS is stale. Run theme:generate.');
} else {
  writeFileSync(outPath, css, 'utf-8');
}
console.log(`✅ Generated ${outPath} (${css.length} bytes)`);
