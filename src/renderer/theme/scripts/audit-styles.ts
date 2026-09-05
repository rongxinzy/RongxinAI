import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKEN_CONTRACT } from '../tokens/contract';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const variables = new Set<string>(Object.values(TOKEN_CONTRACT));
const exceptions: Record<string, string> = {
  'src/renderer/components/cowork/helpers/exportUtils.ts':
    'Portable conversation exports use print-oriented document styling.',
  'src/renderer/components/artifacts/ArtifactPanel.tsx':
    'Standalone exported documents preserve portable content styling.',
  'src/renderer/components/boot/ParticleBootScreen.tsx':
    'Particle colors are sampled from the product logo image.',
  'src/renderer/components/expert/expertAvatars.tsx':
    'Authored avatar artwork preserves its own colors.',
};
const violations: string[] = [];
let scanned = 0;
function scan(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      scan(path);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
    const name = relative(root, path);
    if (name.includes('/icons/') || exceptions[name]) continue;
    scanned++;
    const source = readFileSync(path, 'utf8');
    source.split('\n').forEach((line, index) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (
        /(?:["'`])(?:#[\da-f]{3,8}|rgba?\([^)]*\))(?:["'`])/i.test(line) ||
        /(?:bg|text|border)-\[#/.test(line)
      ) {
        violations.push(`${name}:${index + 1}: literal color outside a theme plugin`);
      }
      for (const match of line.matchAll(
        /(?:bg|text|border|ring|stroke|fill|from|to|via|outline|decoration|shadow)-((?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|white|black)\b/g,
      )) {
        if (!variables.has(`--zy-component-palette-${match[1]}`))
          violations.push(`${name}:${index + 1}: unregistered palette color ${match[1]}`);
      }
    });
  }
}
scan(resolve(root, 'src/renderer/components'));
scan(resolve(root, 'src/shared/components'));

// Migrated primitives must not reintroduce state appearance utilities. Keep
// cursor, pointer-events, positioning and other interaction/layout rules local.
const recipePrimitives = [
  'button',
  'button-group',
  'input',
  'textarea',
  'input-group',
  'select',
  'badge',
  'card',
  'dialog',
  'popover',
  'command',
  'dropdown-menu',
  'sheet',
  'tooltip',
  'hover-card',
  'tabs',
  'page-tabs',
];
const stateAppearance =
  /(?:hover|focus-visible|focus|active|disabled|aria-invalid|aria-selected|aria-pressed|data-checked|data-selected|data-highlighted)[^\s"'`]*:(?:bg-|text-|border-|ring-|opacity-|shadow-|rounded-|font-)/;
for (const primitive of recipePrimitives) {
  const name = `src/shared/components/ui/${primitive}.tsx`;
  readFileSync(resolve(root, name), 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (stateAppearance.test(line)) {
        violations.push(`${name}:${index + 1}: state appearance must belong to a component recipe`);
      }
    });
}
const editorSource = readFileSync(resolve(root, 'src/renderer/components/CodeBlock.tsx'), 'utf8');
for (const match of editorSource.matchAll(/'(\.cm-search-[^']+)'\s*:\s*\{([^}]+)\}/g)) {
  if (
    /\b(?:background(?:Color)?|color|border(?:Color|Radius|Bottom)?|font(?:Size|Family|VariantNumeric)|outline|accentColor|transition)\s*:/.test(
      match[2],
    )
  ) {
    violations.push(
      `CodeBlock.tsx ${match[1]}: search control appearance must belong to an editor recipe`,
    );
  }
}
if (violations.length) throw new Error(violations.join('\n'));
console.log(
  `[Theme] ${scanned} component modules audited; color sources belong to theme plugins or documented content artwork.`,
);
