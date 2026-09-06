import { expect, test } from 'vitest';
import { weiyangLight, weiyangDark } from './weiyang';
import { BackgroundTexture, backgroundStyle } from '../background/background';
import { damingLight } from './daming';
import { classicLight } from './classic-light';
import { resolveThemePlugin, validateTheme } from './plugins';

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const rgb = hex.match(/[a-f\d]{2}/gi)!.map(channel => {
      const v = parseInt(channel, 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('Weiyang provides complete appearances without replacing the default package', () => {
  for (const theme of [weiyangLight, weiyangDark]) validateTheme(theme);
  expect(resolveThemePlugin('weiyang').appearances.light).toBe(weiyangLight);
  expect(resolveThemePlugin('unknown').id).toBe('codex');
  expect(weiyangLight.components['fluid-indicator']).not.toBe(
    classicLight.components['fluid-indicator'],
  );
  expect(classicLight.components['fluid-indicator'].base['border-radius']).toBe('9999px');
});

test('Weiyang text and primary actions retain AA contrast on their surfaces', () => {
  for (const theme of [weiyangLight, weiyangDark]) {
    const t = theme.tokens;
    for (const surface of [t.background, t.surface, t['surface-raised']]) {
      for (const text of [
        t.foreground,
        t['text-muted-foreground'],
        t.primary,
        t.warning,
        t.success,
        t.destructive,
      ]) {
        expect(
          contrast(text, surface),
          `${theme.meta.id}: ${text} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(
      contrast(t['switch-thumb-foreground'], t['style-work-chat-thumb']),
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['primary-foreground'], t['primary-strong'])).toBeGreaterThanOrEqual(4.5);
  }
});

test('Weiyang owns sidebar and legacy warning/error foreground roles', () => {
  for (const theme of [weiyangLight, weiyangDark]) {
    const t = theme.tokens;
    expect(t['semantic-sidebar']).toBe(t['surface-raised']);
    expect(t['semantic-sidebar-ring']).toBe(t.primary);
    expect(t['component-palette-amber-500']).toBe(t.warning);
    expect(t['component-palette-yellow-700']).toBe(t.warning);
    expect(t['component-palette-red-500']).toBe(t.destructive);
  }
});


test('Weiyang keeps cloud backgrounds and carved controls inside its package', () => {
  expect(weiyangLight.tokens.radius).toBe('0.375rem');
  expect(damingLight.tokens.radius).toBe('0.5rem');
  expect(weiyangLight.components.heading.base['font-weight']).toBe('600');
  for (const theme of [weiyangLight, weiyangDark]) {
    expect(theme.background?.texture).toBe(BackgroundTexture.Clouds);
    const paint = backgroundStyle(theme.background!);
    expect(paint['--main-background-image']).toContain('data:image/svg+xml');
    expect(paint['--main-background-repeat']).toBe('no-repeat');
    expect(Number(paint['--main-background-opacity'])).toBeLessThan(0.2);
    expect(theme.components['button-size-default'].base.height).toBe(classicLight.components['button-size-default'].base.height);
  }
});
