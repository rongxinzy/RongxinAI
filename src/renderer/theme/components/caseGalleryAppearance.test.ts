import { expect, test } from 'vitest';

import { classicComponentAppearances } from './classic';

/**
 * 案例卡是「缩略图 + 标题」，卡片本身不画边框和底板。一旦 recipe 重新加回边框或实心底色，
 * 缩略图就不再是这一格里唯一的实心块，卡片会退回被方框包住的旧样式。
 */
test('case tiles stay frameless and only paint a surface when interacted with', () => {
  for (const dark of [false, true]) {
    const card = classicComponentAppearances(dark)['page-case-gallery-card'];

    expect(card.base['border-width']).toBeUndefined();
    expect(card.base['border-style']).toBe('none');
    expect(card.base['background-color']).toBe('transparent');
    expect(card.base['border-radius']).toBe('var(--zy-style-radius-lg)');
    expect(card.hover['background-color']).toBe('var(--zy-surface-raised)');
    expect(card.selected['background-color']).toBe('var(--zy-primary-muted)');
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

/** 卡片接管了内边距，标题区只负责行距；两边都留 padding 会把缩略图挤小两遍。 */
test('case captions own spacing only, because the tile owns the padding', () => {
  const body = classicComponentAppearances(false)['page-case-gallery-body'];

  expect(body.base.gap).toBe('0.25rem');
  expect(body.base.padding).toBeUndefined();
});
