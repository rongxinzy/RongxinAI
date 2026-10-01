import { expect, test } from 'vitest';
import { generateThemeCSS } from '../engine/css-generator';
import { classicLight } from '../themes/classic-light';

test('the compact indicator icon overrides the shared spinner size without changing other spinners', () => {
  const css = generateThemeCSS(classicLight);
  const base = css.indexOf(':where(.theme-spinner) {');
  const compact = css.indexOf(':where(.theme-run-indicator .theme-spinner) {');
  expect(base).toBeGreaterThan(-1);
  expect(compact).toBeGreaterThan(base);
  expect(css.slice(compact, css.indexOf('}', compact))).toContain('width: 0.75rem');
});
