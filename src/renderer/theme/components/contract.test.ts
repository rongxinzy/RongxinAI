import { expect, test } from 'vitest';
import { recipe } from './recipe';
import { classicLight } from '../themes/classic-light';
import { generateThemeCSS } from '../engine/css-generator';
import { validateComponentAppearances } from './contract';

test('requires complete state declarations and rejects selector and behavior injection', () => {
  const missing = structuredClone(classicLight.components);
  Reflect.deleteProperty(missing.input, 'focus');
  expect(() => validateComponentAppearances(missing)).toThrow('Missing component state');
  for (const [property, value] of [
    ['display', 'none'],
    ['pointer-events', 'none'],
    ['color', 'red; } body { display: none'],
    ['background-color', 'url(https://example.com/pixel)'],
    ['color', 'red !important'],
    ['color', 'var(--missing-theme-variable)'],
  ]) {
    const invalid = structuredClone(classicLight.components);
    Object.assign(invalid.input.base, { [property]: value });
    expect(() => validateComponentAppearances(invalid)).toThrow();
  }
});

test('compiles theme-owned state values with disabled guards and reduced motion', () => {
  const theme = structuredClone(classicLight);
  theme.meta.id = 'recipe-proof';
  theme.components.input.hover['border-color'] = 'var(--zy-primary)';
  theme.components.input.focus['outline-width'] = '2px';
  const css = generateThemeCSS(theme);
  expect(css).toContain('[data-theme="recipe-proof"] :where(.theme-input)');
  expect(css).toContain(
    ':not(:disabled):not([aria-disabled="true"]):not([data-disabled=""]):not([data-disabled="true"]):hover',
  );
  expect(css).toContain('outline-width: 2px');
  expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  expect(css.indexOf('::placeholder')).toBeGreaterThan(css.indexOf(':focus-visible'));
});

test('variant bases precede interactive states and size recipes remain theme data', () => {
  const css = generateThemeCSS(classicLight);
  expect(css.indexOf(':where(.theme-button-outline) {')).toBeLessThan(
    css.indexOf(':where(.theme-button):where(:not(:disabled)'),
  );
  const theme = structuredClone(classicLight);
  theme.components['button-size-default'].base.height = '2.25rem';
  expect(generateThemeCSS(theme)).toContain('height: 2.25rem');
  expect(theme.components['select-content'].entering.opacity).toBe('0');
  expect(theme.components['badge-destructive'].focus['box-shadow']).toContain('--destructive');
});

test('font-size overrides retain theme line-height while allowing explicit typography', () => {
  const inherited = recipe({ base: { 'font-size': 'var(--zy-component-text-xs)' } });
  expect(inherited.base['line-height']).toBe('var(--zy-component-text-xs--line-height)');
  const explicit = recipe({
    base: { 'font-size': 'var(--zy-component-text-xs)', 'line-height': '1.5' },
  });
  expect(explicit.base['line-height']).toBe('1.5');
});

test('isolates theme motion and places pseudo-element state selectors on their owners', () => {
  const theme = structuredClone(classicLight);
  theme.meta.id = 'motion-proof';
  const css = generateThemeCSS(theme);
  const original = generateThemeCSS(classicLight);
  const motion = css.match(/animation-name: (zy-component-composer-far-[\w-]+)/)?.[1];
  expect(motion).toBeTruthy();
  expect(original).not.toContain(`animation-name: ${motion};`);
  expect(css).toContain(`@keyframes ${motion}`);
  expect(css).toContain(
    ':where(.input-aura):where(:has(:is([data-slot="input-group-control"], [contenteditable]):focus-visible))::after',
  );
  expect(css).not.toContain(':where(.input-aura::after)');
  expect(css).toContain('animation: none');
  theme.components['composer-far'].motionStart['box-shadow'] = 'none';
  expect(() => validateComponentAppearances(theme.components)).toThrow(
    'Invalid component motion property',
  );
});

test('shared fluid tabs retain Codex geometry and hover feedback in theme recipes', () => {
  const c = classicLight.components;
  expect(c['fluid-tab-default'].base.height).toBe('2rem');
  expect(c['fluid-tab'].base['font-weight']).toBe('var(--zy-component-font-weight-normal)');
  expect(c['fluid-hover-indicator'].base['background-color']).toBe('var(--zy-surface)');
  expect(c['fluid-hover-indicator'].base.opacity).toBe('0');
  expect(c['fluid-hover-visible'].parentHover.opacity).toBe('1');
  expect(c['fluid-hover-visible'].parentFocus.opacity).toBe('1');
});

test('selected appearances recognize both Base UI boolean attributes and string states', () => {
  const css = generateThemeCSS(classicLight);
  expect(css).toContain('[data-active=""]');
  expect(css).toContain('[data-active="true"]');
  expect(css).toContain('[data-state="selected"]');
});

test('component gradients can be themed without allowing remote image requests', () => {
  const theme = structuredClone(classicLight);
  theme.components['loading-shimmer-layer'].base['background-image'] =
    'linear-gradient(90deg, transparent, var(--zy-primary), transparent)';
  expect(() => validateComponentAppearances(theme.components)).not.toThrow();
  theme.components['loading-shimmer-layer'].base['background-image'] =
    'url(https://example.com/tracker.png)';
  expect(() => validateComponentAppearances(theme.components)).toThrow();
});
