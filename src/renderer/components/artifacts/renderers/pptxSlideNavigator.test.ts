import { describe, expect, test } from 'vitest';

import {
  buildPptxSlideDocument,
  isPptxNavigationKey,
  resolvePptxSlideIndex,
} from './pptxSlideNavigation';

describe('resolvePptxSlideIndex', () => {
  test('moves between slides with arrow and paging keys', () => {
    expect(resolvePptxSlideIndex(2, 5, 'ArrowRight')).toBe(3);
    expect(resolvePptxSlideIndex(2, 5, 'ArrowDown')).toBe(3);
    expect(resolvePptxSlideIndex(2, 5, 'PageDown')).toBe(3);
    expect(resolvePptxSlideIndex(2, 5, 'ArrowLeft')).toBe(1);
    expect(resolvePptxSlideIndex(2, 5, 'ArrowUp')).toBe(1);
    expect(resolvePptxSlideIndex(2, 5, 'PageUp')).toBe(1);
  });

  test('supports first, last, and space navigation without wrapping', () => {
    expect(resolvePptxSlideIndex(3, 5, 'Home')).toBe(0);
    expect(resolvePptxSlideIndex(1, 5, 'End')).toBe(4);
    expect(resolvePptxSlideIndex(3, 5, ' ')).toBe(4);
    expect(resolvePptxSlideIndex(4, 5, 'ArrowRight')).toBe(4);
    expect(resolvePptxSlideIndex(0, 5, 'ArrowLeft')).toBe(0);
  });

  test('clamps invalid state and ignores unrelated keys', () => {
    expect(resolvePptxSlideIndex(12, 5, 'Tab')).toBe(4);
    expect(resolvePptxSlideIndex(-2, 5, 'Tab')).toBe(0);
    expect(resolvePptxSlideIndex(2, 0, 'ArrowRight')).toBe(0);
  });
});

test('recognizes only keys handled by the slide navigator', () => {
  expect(isPptxNavigationKey('ArrowRight')).toBe(true);
  expect(isPptxNavigationKey(' ')).toBe(true);
  expect(isPptxNavigationKey('Tab')).toBe(false);
});

test('builds an isolated slide document without enabling scripts', () => {
  const document = buildPptxSlideDocument('<div class="pptx-preview-slide-wrapper">A</div>');

  expect(document).toContain("default-src 'none'");
  expect(document).toContain("style-src 'unsafe-inline'");
  expect(document).not.toContain('script-src');
  expect(document).toContain('pptx-preview-slide-wrapper');
});
