import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared generator context: repository paths, the case manifest with its English
// scenario text, and the mutable quick-action catalogues this script rewrites.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const manifest = JSON.parse(
  readFileSync(join(root, 'scripts/quick-case-sites.json'), 'utf8'),
);
// English scenario text sits beside the manifest so the English prompt and description carry the same
// audience, scope and indicators as the Chinese one instead of a shared boilerplate sentence.
export const enScenario = JSON.parse(
  readFileSync(join(root, 'scripts/quick-case-sites.en.json'), 'utf8'),
);
export const outDir = join(root, 'SKILLs/frontend-design/templates/quick-cases');
export const assetsDir = join(outDir, 'assets');
export const cataloguePath = join(root, 'public/quick-actions.json');
export const i18nPath = join(root, 'public/quick-actions-i18n.json');
export const catalog = JSON.parse(readFileSync(cataloguePath, 'utf8'));
export const i18n = JSON.parse(readFileSync(i18nPath, 'utf8'));

export const configs = {
  pptx: {
    action: 'pptx',
    zh: '制作幻灯片',
    en: 'Create a presentation',
    kind: 'DECK / 16:9',
    accent: '#db9b4b',
  },
  excel: {
    action: 'data-analysis',
    zh: '数据分析',
    en: 'Analyze data',
    kind: 'WORKBOOK / LIVE VIEW',
    accent: '#43876d',
  },
  website: {
    action: 'website',
    zh: '创建网站',
    en: 'Create a website',
    kind: 'WEB EXPERIENCE / INTERACTIVE',
    accent: '#75b8ae',
  },
  research: {
    action: 'deep-research',
    zh: '深度调研',
    en: 'Deep research',
    kind: 'RESEARCH BRIEF / EVIDENCE LEDGER',
    accent: '#238d82',
  },
  academic: {
    action: 'academic-research',
    zh: '学术研究',
    en: 'Academic research',
    kind: 'RESEARCH DESIGN / METHODS',
    accent: '#9879c7',
  },
  docs: {
    action: 'docs',
    zh: '文档',
    en: 'Create a document',
    kind: 'FIELD GUIDE / DECISION DOCUMENT',
    accent: '#bc8250',
  },
};
