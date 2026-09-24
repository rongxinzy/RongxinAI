import { expect, test } from 'vitest';

import { classicComponentAppearances } from './classic';

/**
 * 缩略图铺满整格，卡片自身不能画底色：那层底色会压在图片背后，永远看不见。
 * hover 反馈因此挂在图片之上的说明层（见下面的 caption 用例），选中态用外描边表达。
 */
test('case tiles keep edge-to-edge artwork and never paint a surface behind it', () => {
  for (const dark of [false, true]) {
    const card = classicComponentAppearances(dark)['page-case-gallery-card'];

    expect(card.base['border-width']).toBeUndefined();
    expect(card.base['border-style']).toBe('none');
    expect(card.base['background-color']).toBe('transparent');
    expect(card.base['border-radius']).toBe('var(--zy-style-radius-lg)');
    expect(card.base.padding).toBe('0');
    expect(card.hover['background-color']).toBeUndefined();
    expect(card.hover['box-shadow']).toBeUndefined();
    expect(card.selected['background-color']).toBeUndefined();
    expect(card.selected['outline-style']).toBe('solid');
    expect(card.selected['outline-width']).toBe('2px');
    expect(card.selected['outline-color']).toBe('var(--zy-primary)');
    expect(card.selected['outline-offset']).toBe('2px');
  }
});

/**
 * 缩略图自己收圆角，靠的是图片的圆角而不是外面套一个框。
 * 曾经的 border-bottom 分隔线属于旧卡片样式，不得回来。
 */
test('case thumbnails round their own corners instead of sitting inside a frame', () => {
  const media = classicComponentAppearances(false)['page-case-gallery-media'];

  expect(media.base['border-radius']).toBe('var(--zy-style-radius-md)');
  expect(media.base['border-bottom-width']).toBeUndefined();
});

/**
 * 说明层是图片之上唯一的图层，标题可读性与 hover 反馈都挂在它上面。
 * 标题走深色 + 60% 白纱：45 张内置缩略图顶部中位亮度 0.96（近白），白纱在它们之上几乎不可见，
 * 因此卡片看起来是浅色的；对少数深色顶部的 web 截图，白纱把底色抬到 0.6 sRGB，实测最差 6.1:1。
 */
test('case captions use a light veil with dark text and carry the tile hover', () => {
  const body = classicComponentAppearances(false)['page-case-gallery-body'];

  expect(body.base.color).toBe('var(--zy-component-palette-zinc-950)');
  expect(body.base.padding).toBe('0.75rem');
  expect(body.base['font-size']).toBe('var(--zy-component-text-sm)');
  expect(body.base['font-weight']).toBe('500');
  expect(body.base['background-image']).toBe(
    'linear-gradient(to bottom, transparent 0, color-mix(in oklab, var(--zy-component-palette-white) 60%, transparent) 0.5rem, color-mix(in oklab, var(--zy-component-palette-white) 60%, transparent) 2rem, transparent 2.75rem)',
  );
  expect(body.base['transition-duration']).toBe('200ms');
  expect(body.hover['background-color']).toBe(
    'color-mix(in oklab, var(--zy-component-overlay-strong) 22%, transparent)',
  );
});
