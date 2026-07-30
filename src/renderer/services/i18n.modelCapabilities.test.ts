import { afterEach, describe, expect, test } from 'vitest';

import { i18nService } from './i18n';

afterEach(() => {
  i18nService.setLanguage('zh', { persist: false });
});

describe('model capability translations', () => {
  test('provides complete Chinese labels and fallback messages', () => {
    i18nService.setLanguage('zh', { persist: false });
    expect(i18nService.t('modelCapabilities')).toBe('模型能力');
    expect(i18nService.t('capabilityToolCalling')).toBe('工具调用');
    expect(i18nService.t('capabilityUnknown')).toBe('未知');
    expect(i18nService.t('toolCapabilityUnknownFallback')).toContain('尚未确认');
  });

  test('provides complete English labels and fallback messages', () => {
    i18nService.setLanguage('en', { persist: false });
    expect(i18nService.t('modelCapabilities')).toBe('Model capabilities');
    expect(i18nService.t('capabilityToolCalling')).toBe('Tool calling');
    expect(i18nService.t('capabilityUnknown')).toBe('Unknown');
    expect(i18nService.t('toolCapabilityUnknownFallback')).toContain('regular chat');
  });
});
