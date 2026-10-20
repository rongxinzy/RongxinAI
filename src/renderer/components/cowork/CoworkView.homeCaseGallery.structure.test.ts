import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./HomeStudio.tsx', import.meta.url)), 'utf8');
const compact = (value: string) => value.replace(/\s+/g, '');

const barCall = '<QuickActionBar actions={quickActions} onActionSelect={onActionSelect} />';
const panelCall = '<PromptPanel action={selectedAction}';

test('keeps the case gallery and the suggestion pills in separate stages', () => {
  const compactSource = compact(source);
  expect(compactSource.split(compact(barCall)).length - 1).toBe(1);
  expect(compactSource.split(compact(panelCall)).length - 1).toBe(1);
  expect(compactSource.indexOf(compact(panelCall))).toBeLessThan(
    compactSource.indexOf(compact(barCall)),
  );
  expect(source).toContain('selectedAction ?');
  expect(source).not.toContain('sticky');
  expect(source).not.toContain('zhiyuan-logo');
});

test('centers the idle studio and pins the footnote to the panel', () => {
  expect(source).toContain('justify-center');
  expect(source).toContain('pb-12');
  expect(source).toContain('theme-home-greeting');
  expect(source).toContain('whitespace-nowrap');
  expect(source).toContain('theme-home-footnote');
  expect(source).toContain('max-w-3xl');
});

test('holds the composer above an independently scrolling gallery', () => {
  const galleryBranch = source.slice(source.indexOf('selectedAction ?'), source.indexOf(') : ('));
  expect(galleryBranch).toContain('shrink-0');
  expect(galleryBranch).toContain('overflow-y-auto');
  expect(galleryBranch).not.toContain('theme-home-greeting');
});
