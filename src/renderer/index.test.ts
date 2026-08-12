import fs from 'fs';
import path from 'path';
import { expect, test } from 'vitest';
import { classicDark } from './theme/themes/classic-dark';
import { classicLight } from './theme/themes/classic-light';

test('fluid switch thumbs stay pure white across interaction states', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src', 'renderer', 'index.css'), 'utf-8');

  expect(css).toMatch(
    /\[data-fluid-switch\] \[data-slot='switch-thumb'\]\s*\{\s*background-color: var\(--color-white\) !important;/,
  );
  expect(css).not.toMatch(
    /\[data-fluid-switch\][^{]*:hover[^{]*\[data-slot='switch-thumb'\][^{]*\{[^}]*background-color:/,
  );
});

test('work chat switch keeps its existing thumb token', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src', 'renderer', 'index.css'), 'utf-8');

  expect(css).toMatch(
    /\[data-mode='work-chat'\] \[data-slot='switch-thumb'\]\s*\{\s*background-color: var\(--zy-primary-foreground\) !important;/,
  );
});

test('checked switch tracks use theme-specific contrast tokens', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src', 'renderer', 'index.css'), 'utf-8');
  const themeCss = fs.readFileSync(
    path.join(process.cwd(), 'src', 'renderer', 'theme', 'css', 'themes.css'),
    'utf-8',
  );

  expect(css).toContain('background-color: var(--zy-switch-track-checked);');
  expect(css).toContain('background-color: var(--zy-switch-track-checked-hover);');
  expect(classicLight.tokens['switch-track-checked']).toBe('var(--zy-primary)');
  expect(classicLight.tokens['switch-track-checked-hover']).toBe('var(--zy-primary-hover)');
  expect(classicDark.tokens['switch-track-checked']).toBe('var(--zy-gray-5)');
  expect(classicDark.tokens['switch-track-checked-hover']).toBe('var(--zy-gray-6)');
  expect(themeCss).toContain('--zy-switch-track-checked: var(--zy-gray-5);');
  expect(themeCss).toContain('--zy-switch-track-checked-hover: var(--zy-gray-6);');
});
