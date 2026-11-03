import { describe, expect, test } from 'vitest';

import { inferLanguageFromLocale, resolveFirstRunLanguage } from './defaultLanguage';

describe('default language', () => {
  test('only zh-CN selects Chinese from the system locale', () => {
    expect(inferLanguageFromLocale('zh-CN')).toBe('zh');
    expect(inferLanguageFromLocale('zh-TW')).toBe('en');
    expect(inferLanguageFromLocale('en-US')).toBe('en');
  });

  test('packaged Kylin locale overrides an English system locale on first run', () => {
    expect(resolveFirstRunLanguage('en-US', 'zh-CN')).toBe('zh');
    expect(resolveFirstRunLanguage('en-US', '')).toBe('en');
  });
});
