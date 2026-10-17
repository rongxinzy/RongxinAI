import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { configs, enScenario, manifest, outDir } from './context.mjs';
import { updateCatalogues } from './catalogue.mjs';
import { academic } from './pages/academic.mjs';
import { slidePage } from './pages/deck.mjs';
import { docs } from './pages/docs.mjs';
import { research } from './pages/research.mjs';
import { spreadsheet } from './pages/spreadsheet.mjs';
import { website } from './pages/website.mjs';

function buildPage(c, index) {
  if (c.handcrafted) return;
  const html =
    c.skill === 'pptx'
      ? slidePage(c, index)
      : c.skill === 'excel'
        ? spreadsheet(c, index)
        : c.skill === 'website'
          ? website(c, index)
          : c.skill === 'research'
            ? research(c, index)
            : c.skill === 'academic'
              ? academic(c, index)
              : docs(c, index);
  writeFileSync(join(outDir, `${c.id}.html`), html);
}

if (manifest.length !== 72) throw new Error(`Expected exactly 72 cases, found ${manifest.length}`);
for (const skill of Object.keys(configs)) {
  const cases = manifest.filter(c => c.skill === skill);
  if (cases.length !== 12) throw new Error(`${skill} needs 12 cases, got ${cases.length}`);
  if (new Set(cases.map(c => c.id)).size !== 12) throw new Error(`${skill} has duplicate case ids`);
}
const missingEn = manifest.filter(c => !enScenario[c.id]).map(c => c.id);
if (missingEn.length) throw new Error(`Missing English scenario text: ${missingEn.join(', ')}`);
for (const [index, c] of manifest.entries()) buildPage(c, index % 12);
updateCatalogues();
console.log(`Updated ${manifest.length} cases across ${Object.keys(configs).length} quick skills.`);
