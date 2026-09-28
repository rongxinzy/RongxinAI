import { expect, test } from 'vitest';

import { classicComponentAppearances } from './classic';

/**
 * 卡片是「图片在上、标题在下」的堆叠结构：标题不叠在图上，所以既不需要遮罩，也不该在图片
 * 背后画底色。hover 由标题的层级变化表达，选中态用围绕整块的外描边。
 */
test('case tiles stack the caption under the artwork without overlaying it', () => {
  for (const dark of [false, true]) {
    const card = classicComponentAppearances(dark)['page-case-gallery-card'];

    expect(card.base['border-width']).toBeUndefined();
    expect(card.base['border-style']).toBe('none');
    expect(card.base['background-color']).toBe('transparent');
    expect(card.base['border-radius']).toBe('var(--zy-style-radius-lg)');
    expect(card.base.padding).toBe('0');
    expect(card.base.gap).toBe('0.5rem');
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
 * 标题落在页面底色上，因此是常规次级文字：无遮罩、无内边距，
 * hover 时升到正文色（DESIGN.md 允许的「文字层级变化」）。
 */
test('case captions are plain secondary text that steps up on hover', () => {
  const body = classicComponentAppearances(false)['page-case-gallery-body'];

  expect(body.base.color).toBe('var(--muted-foreground)');
  expect(body.base['font-size']).toBe('var(--zy-component-text-sm)');
  expect(body.base['font-weight']).toBe('500');
  expect(body.base['background-image']).toBeUndefined();
  expect(body.base.padding).toBeUndefined();
  expect(body.base['transition-duration']).toBe('200ms');
  expect(body.parentHover.color).toBe('var(--foreground)');
});
