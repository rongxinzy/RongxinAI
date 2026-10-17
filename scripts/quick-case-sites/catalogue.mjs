import { writeFileSync } from 'node:fs';

import {
  catalog,
  cataloguePath,
  configs,
  enScenario,
  i18n,
  i18nPath,
  manifest,
} from './context.mjs';
import { enLabels, englishPrompt, promptFor, stripTail } from './prompts.mjs';

export function updateCatalogues() {
  const skillOrder = ['pptx', 'excel', 'website', 'research', 'academic', 'docs'];
  catalog.actions = catalog.actions.filter(a => skillOrder.some(s => configs[s].action === a.id));
  for (const skill of skillOrder) {
    const cfg = configs[skill];
    const action = catalog.actions.find(a => a.id === cfg.action);
    if (!action) throw new Error(`Missing quick action ${cfg.action}`);
    action.prompts = manifest
      .filter(c => c.skill === skill)
      .map(c => ({ id: c.id, preview: `./case-previews/${c.id}.webp` }));
  }
  for (const language of ['zh', 'en']) {
    for (const actionId of Object.keys(i18n[language])) {
      if (!catalog.actions.some(a => a.id === actionId)) delete i18n[language][actionId];
    }
    for (const skill of skillOrder) {
      const cfg = configs[skill];
      const actionId = cfg.action;
      i18n[language][actionId] ??= { label: cfg[language] ?? cfg.en, prompts: {} };
      const actionInfo = i18n[language][actionId];
      actionInfo.prompts = {};
      for (const c of manifest.filter(item => item.skill === skill)) {
        actionInfo.prompts[c.id] = {
          label: language === 'zh' ? c.label : (enLabels[c.id] ?? c.label),
          description: language === 'zh' ? c.lead : `${stripTail(enScenario[c.id].description)}.`,
          prompt: language === 'zh' ? promptFor(c) : englishPrompt(c),
        };
      }
    }
  }
  writeFileSync(cataloguePath, `${JSON.stringify(catalog, null, 2)}\n`);
  writeFileSync(i18nPath, `${JSON.stringify(i18n, null, 2)}\n`);
}
