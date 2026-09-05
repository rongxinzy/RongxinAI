import { expect, test } from 'vitest';
import {
  BackgroundFit,
  BackgroundKind,
  BackgroundTexture,
  DEFAULT_BACKGROUND,
  backgroundStyle,
  normalizeBackground,
} from './background';

test('normalizes theme backgrounds without allowing remote URLs or CSS injection', () => {
  const value = normalizeBackground({
    kind: BackgroundKind.Image,
    color: 'red;display:none',
    image: 'https://example.com/image.png',
    opacity: 3,
  });
  expect(value.color).toBe(DEFAULT_BACKGROUND.color);
  expect(value.image).toBeUndefined();
  expect(value.opacity).toBe(1);
  expect(normalizeBackground({ opacity: NaN }).opacity).toBe(DEFAULT_BACKGROUND.opacity);
  expect(normalizeBackground({ opacity: -1 }).opacity).toBe(0);
});

test('keeps layer opacity separate and renders each texture and image fit deterministically', () => {
  for (const texture of Object.values(BackgroundTexture)) {
    const style = backgroundStyle({
      ...DEFAULT_BACKGROUND,
      kind: BackgroundKind.Texture,
      texture,
      opacity: 0,
    });
    expect(style['--main-background-opacity']).toBe('0');
    expect(style['--main-background-image']).not.toBe('none');
    expect(style).not.toHaveProperty('opacity');
  }
  const style = backgroundStyle({
    ...DEFAULT_BACKGROUND,
    kind: BackgroundKind.Image,
    image: 'data:image/png;base64,YQ==',
    fit: BackgroundFit.Tile,
  });
  expect(style['--main-background-repeat']).toBe('repeat');
  expect(style['--main-background-size']).toBe('auto');
  expect(backgroundStyle(DEFAULT_BACKGROUND)['--main-background-opacity']).toBe('0');
});

test('accepts bundled assets while rejecting remote and malformed paths', () => {
  expect(normalizeBackground({ image: './assets/paper-a1b2.webp' }).image).toBe(
    './assets/paper-a1b2.webp',
  );
  expect(normalizeBackground({ image: '/themes/paper.svg' }).image).toBe('/themes/paper.svg');
  expect(normalizeBackground({ image: '//example.com/paper.png' }).image).toBeUndefined();
  expect(normalizeBackground({ image: '/themes/paper.png\")' }).image).toBeUndefined();
});
