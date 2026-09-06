import { expect, test } from 'vitest';
import { classicDark } from './theme/themes/classic-dark';
import { classicLight } from './theme/themes/classic-light';
import { generateThemeCSS } from './theme/engine/css-generator';

test('Codex switch retains white thumbs, accent tracks and original dimensions', () => {
  for (const theme of [classicLight, classicDark]) {
    const t = theme.tokens;
    const c = theme.components;
    expect(t['style-switch-thumb']).toBe('#ffffff');
    expect(t['style-work-chat-thumb']).toBe('var(--zy-primary-foreground)');
    expect(t['style-switch-width']).toBe('34px');
    expect(t['style-switch-height']).toBe('20px');
    expect(t['style-switch-thumb-size']).toBe('16px');
    expect(t['style-switch-width-sm']).toBe('24px');
    expect(t['style-switch-height-sm']).toBe('14px');
    expect(t['style-switch-thumb-size-sm']).toBe('12px');
    expect(c['switch-thumb'].base['background-color']).toBe('var(--zy-style-switch-thumb)');
    expect(c['switch-thumb'].hover).toEqual({});
    expect(c['switch-checked'].base['background-color']).toBe('var(--zy-switch-track-checked)');
    expect(c['switch-fluid-checked'].hover['background-color']).toBe(
      'var(--zy-switch-track-checked-hover)',
    );
    const css = generateThemeCSS(theme);
    expect(css.indexOf(':where(.theme-switch[data-checked]) {')).toBeLessThan(
      css.indexOf(':where(.theme-switch[data-fluid-switch][data-checked]):where('),
    );
  }
});
