/**
 * Generates cohesive cute pastel SVG skill icons under SKILLs/<id>/zhiyuan/icon.svg
 * Run: node scripts/generate-cute-skill-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.join(__dirname, '..', 'SKILLs');

const INK = '#5D4E63';
const STROKE = 2;
const RX = 14;

const THEMES = {
  sky: { from: '#E8F4FC', to: '#CFE8F8', accent: '#5BA4D9', soft: '#9CCCEB' },
  peach: { from: '#FFF0E8', to: '#FFE2D4', accent: '#E8956A', soft: '#F5C4A8' },
  mint: { from: '#E8F8F0', to: '#D0F0E0', accent: '#5CB88A', soft: '#9AD4B8' },
  lavender: { from: '#F0EBFF', to: '#E0D6FF', accent: '#9B87DE', soft: '#C4B8F0' },
  lemon: { from: '#FFF9E6', to: '#FFF0C4', accent: '#E5B84A', soft: '#F5D88A' },
  rose: { from: '#FFE8F0', to: '#FFD6E4', accent: '#E87AA0', soft: '#F5B0C8' },
  butter: { from: '#FFF8E8', to: '#FFEFD0', accent: '#D9A84A', soft: '#F0D090' },
  coral: { from: '#FFECE8', to: '#FFD8D0', accent: '#E87868', soft: '#F5B0A8' },
  periwinkle: { from: '#E8EEFF', to: '#D4DEFF', accent: '#7B8FDE', soft: '#A8B8F0' },
};

/** @type {Record<string, { theme: keyof typeof THEMES, glyph: string }>} */
const SKILL_CONFIG = {
  'ad-copywriter': { theme: 'rose', glyph: 'pen' },
  'ad-creative': { theme: 'coral', glyph: 'sparkle' },
  'campaign-planner': { theme: 'peach', glyph: 'megaphone' },
  'churn-prevention': { theme: 'mint', glyph: 'heart' },
  'code-arch-optimizer': { theme: 'periwinkle', glyph: 'layers' },
  'code-safety-audit': { theme: 'mint', glyph: 'shield' },
  'code-to-chart': { theme: 'sky', glyph: 'chart' },
  'content-research-writer': { theme: 'butter', glyph: 'pen' },
  'copy-editor': { theme: 'lavender', glyph: 'doc' },
  copywriting: { theme: 'rose', glyph: 'pen' },
  'customer-reply-craft': { theme: 'peach', glyph: 'chat' },
  'database-inspector': { theme: 'sky', glyph: 'database' },
  'deep-research': { theme: 'lavender', glyph: 'search' },
  'deli-autoresearch': { theme: 'lavender', glyph: 'search' },
  docx: { theme: 'sky', glyph: 'doc' },
  'ecom-copy-assistant': { theme: 'coral', glyph: 'cart' },
  'frontend-design': { theme: 'rose', glyph: 'palette' },
  'git-repo-audit': { theme: 'periwinkle', glyph: 'git' },
  'humanizer-zh': { theme: 'peach', glyph: 'chat' },
  'imap-smtp-email': { theme: 'sky', glyph: 'mail' },
  'legal-contract-gen': { theme: 'lavender', glyph: 'scale' },
  'legal-risk-analyzer': { theme: 'lavender', glyph: 'shield' },
  'log-diagnostic': { theme: 'periwinkle', glyph: 'terminal' },
  'marketing-writer': { theme: 'rose', glyph: 'megaphone' },
  'meeting-recap': { theme: 'mint', glyph: 'doc' },
  'paper-review-coach': { theme: 'butter', glyph: 'book' },
  pdf: { theme: 'coral', glyph: 'doc' },
  'process-doc': { theme: 'butter', glyph: 'flow' },
  'programming-tutor': { theme: 'periwinkle', glyph: 'code' },
  'py-perf-analyzer': { theme: 'mint', glyph: 'chart' },
  'regression-insight': { theme: 'sky', glyph: 'chart' },
  'research-advisor': { theme: 'lavender', glyph: 'book' },
  'research-paper-refiner': { theme: 'lavender', glyph: 'doc' },
  'research-writer': { theme: 'butter', glyph: 'pen' },
  'saas-analyzer': { theme: 'sky', glyph: 'chart' },
  'saas-metrics-coach': { theme: 'mint', glyph: 'chart' },
  'scientific-problem-selection': { theme: 'lavender', glyph: 'microscope' },
  'seo-audit': { theme: 'lemon', glyph: 'search' },
  'skill-creator': { theme: 'lemon', glyph: 'sparkle' },
  'smart-commit-gen': { theme: 'periwinkle', glyph: 'git' },
  'sql-tutor': { theme: 'sky', glyph: 'database' },
  'web-search': { theme: 'sky', glyph: 'search' },
  'web-security-audit': { theme: 'mint', glyph: 'shield' },
  'xindaya-translator': { theme: 'peach', glyph: 'globe' },
  xlsx: { theme: 'mint', glyph: 'chart' },
  'zhiyuan-expert-manager': { theme: 'lavender', glyph: 'bot' },
};

function glyphSvg(glyph, t) {
  const motifs = {
    pen: `<path d="M30 12 L34 14 L22 36 L16 38 L18 32 Z" fill="${t.accent}" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/><path d="M10 32 C14 34, 18 33, 22 30" stroke="${t.soft}" stroke-width="${STROKE}" stroke-linecap="round" fill="none"/>`,
    chart: `<rect x="14" y="24" width="4" height="10" rx="1.5" fill="${t.accent}"/><rect x="22" y="18" width="4" height="16" rx="1.5" fill="${t.accent}"/><rect x="30" y="22" width="4" height="12" rx="1.5" fill="${t.soft}"/>`,
    code: `<path d="M16 18 L12 24 L16 30 M32 18 L36 24 L32 30" stroke="${INK}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/>`,
    doc: `<path d="M16 12 H28 L34 18 V36 H16 Z" fill="white" fill-opacity="0.6" stroke="${t.accent}" stroke-width="1.4" stroke-linejoin="round"/><line x1="20" y1="22" x2="30" y2="22" stroke="${t.soft}" stroke-width="1.4" stroke-linecap="round"/><line x1="20" y1="28" x2="28" y2="28" stroke="${t.soft}" stroke-width="1.4" stroke-linecap="round"/>`,
    search: `<circle cx="22" cy="22" r="7" stroke="${t.accent}" stroke-width="1.6" fill="white" fill-opacity="0.4"/><line x1="27" y1="27" x2="34" y2="34" stroke="${INK}" stroke-width="${STROKE}" stroke-linecap="round"/>`,
    shield: `<path d="M24 12 L34 16 V24 C34 30, 30 34, 24 36 C18 34, 14 30, 14 24 V16 Z" fill="${t.soft}" stroke="${t.accent}" stroke-width="1.4" stroke-linejoin="round"/>`,
    database: `<ellipse cx="24" cy="18" rx="10" ry="4" fill="${t.soft}" stroke="${t.accent}" stroke-width="1.4"/><path d="M14 18 V30 C14 33, 18 35, 24 35 C30 35, 34 33, 34 30 V18" fill="${t.soft}" stroke="${t.accent}" stroke-width="1.4"/>`,
    megaphone: `<path d="M14 22 L22 18 L22 30 L14 26 Z" fill="${t.accent}"/><path d="M32 18 C36 20, 38 24, 36 28" stroke="${t.soft}" stroke-width="1.8" stroke-linecap="round" fill="none"/>`,
    mail: `<rect x="12" y="16" width="24" height="16" rx="3" fill="white" fill-opacity="0.55" stroke="${t.accent}" stroke-width="1.4"/><path d="M12 18 L24 26 L36 18" stroke="${t.accent}" stroke-width="1.4" fill="none"/>`,
    git: `<circle cx="18" cy="30" r="3" fill="${t.soft}" stroke="${t.accent}" stroke-width="1.2"/><circle cx="30" cy="18" r="3" fill="${t.soft}" stroke="${t.accent}" stroke-width="1.2"/><path d="M18 27 V22 C18 20, 28 20, 30 21" stroke="${INK}" stroke-width="1.4" fill="none"/>`,
    book: `<path d="M14 16 C18 14, 22 14, 24 16 V34 C22 32, 18 32, 14 34 Z" fill="${t.soft}" stroke="${t.accent}" stroke-width="1.2"/><path d="M34 16 C30 14, 26 14, 24 16 V34 C26 32, 30 32, 34 34 Z" fill="${t.soft}" stroke="${t.accent}" stroke-width="1.2"/>`,
    palette: `<ellipse cx="24" cy="26" rx="11" ry="9" fill="white" fill-opacity="0.55" stroke="${t.accent}" stroke-width="1.4"/><circle cx="18" cy="24" r="2" fill="${THEMES.sky.accent}"/><circle cx="24" cy="22" r="2" fill="${THEMES.mint.accent}"/><circle cx="30" cy="25" r="2" fill="${THEMES.lemon.accent}"/>`,
    chat: `<ellipse cx="24" cy="24" rx="12" ry="10" fill="white" fill-opacity="0.55" stroke="${t.accent}" stroke-width="1.4"/><circle cx="19" cy="23" r="1.5" fill="${INK}"/><circle cx="24" cy="23" r="1.5" fill="${INK}"/><circle cx="29" cy="23" r="1.5" fill="${INK}"/>`,
    heart: `<path d="M24 34 C16 28, 14 22, 18 18 C21 15, 24 17, 24 17 C24 17, 27 15, 30 18 C34 22, 32 28, 24 34 Z" fill="${t.accent}" fill-opacity="0.85"/>`,
    layers: `<path d="M24 14 L36 20 L24 26 L12 20 Z" fill="${t.soft}" stroke="${t.accent}" stroke-width="1.2"/><path d="M24 20 L36 26 L24 32 L12 26 Z" fill="${t.accent}" fill-opacity="0.35" stroke="${t.accent}" stroke-width="1.2"/>`,
    sparkle: `<path d="M24 12 L25 18 L31 19 L25 20 L24 26 L23 20 L17 19 L23 18 Z" fill="${t.accent}"/>`,
    cart: `<circle cx="20" cy="32" r="2" fill="${INK}"/><circle cx="30" cy="32" r="2" fill="${INK}"/><path d="M14 18 H18 L22 28 H32 L34 22 H20" stroke="${t.accent}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    globe: `<circle cx="24" cy="24" r="10" stroke="${t.accent}" stroke-width="1.4" fill="white" fill-opacity="0.4"/><path d="M14 24 H34 M24 14 C20 18, 20 30, 24 34 M24 14 C28 18, 28 30, 24 34" stroke="${t.soft}" stroke-width="1.2" fill="none"/>`,
    flow: `<rect x="14" y="14" width="8" height="8" rx="2" fill="${t.accent}"/><rect x="26" y="14" width="8" height="8" rx="2" fill="${t.soft}"/><rect x="20" y="28" width="8" height="8" rx="2" fill="${t.accent}"/><path d="M22 18 H26 V28 H24" stroke="${INK}" stroke-width="1.2" fill="none"/>`,
    terminal: `<path d="M14 16 L22 24 L14 32 M26 32 H34" stroke="${INK}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/>`,
    microscope: `<path d="M16 34 H32" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/><path d="M22 34 V22 L28 16" stroke="${t.accent}" stroke-width="1.8" stroke-linecap="round"/><circle cx="28" cy="16" r="4" fill="${t.soft}" stroke="${t.accent}" stroke-width="1.2"/>`,
    scale: `<line x1="24" y1="14" x2="24" y2="32" stroke="${t.accent}" stroke-width="2" stroke-linecap="round"/><line x1="14" y1="20" x2="34" y2="20" stroke="${t.accent}" stroke-width="1.8" stroke-linecap="round"/><path d="M12 24 Q16 28 20 24 Z" fill="${t.soft}"/><path d="M28 24 Q32 28 36 24 Z" fill="${t.soft}"/>`,
    bot: `<rect x="16" y="18" width="16" height="14" rx="4" fill="${t.soft}" stroke="${t.accent}" stroke-width="1.4"/><circle cx="20" cy="25" r="1.6" fill="${INK}"/><circle cx="28" cy="25" r="1.6" fill="${INK}"/><path d="M21 29 Q24 31 27 29" stroke="${INK}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
  };
  return motifs[glyph] ?? motifs.sparkle;
}

function buildSvg(skillId, config) {
  const t = THEMES[config.theme] ?? THEMES.lavender;
  const uid = skillId.replace(/[^a-z0-9]/gi, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <defs>
    <linearGradient id="${uid}-bg" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${t.from}"/>
      <stop offset="100%" stop-color="${t.to}"/>
    </linearGradient>
  </defs>
  <rect width="48" height="48" rx="${RX}" fill="url(#${uid}-bg)"/>
  <ellipse cx="18" cy="12" rx="14" ry="8" fill="white" fill-opacity="0.35"/>
  ${glyphSvg(config.glyph, t)}
</svg>
`;
}

const skillDirs = fs.readdirSync(skillsRoot, { withFileTypes: true }).filter(d => d.isDirectory());

let written = 0;
for (const dir of skillDirs) {
  const skillId = dir.name;
  const zhiyuanDir = path.join(skillsRoot, skillId, 'zhiyuan');
  if (!fs.existsSync(zhiyuanDir)) continue;

  const config = SKILL_CONFIG[skillId] ?? { theme: 'lavender', glyph: 'sparkle' };
  const outPath = path.join(zhiyuanDir, 'icon.svg');
  fs.writeFileSync(outPath, buildSvg(skillId, config), 'utf8');
  written += 1;
}

console.log(`Wrote ${written} cute skill icon.svg files.`);
