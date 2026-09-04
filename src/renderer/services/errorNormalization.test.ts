import { beforeEach, describe, expect, test } from 'vitest';
import { i18nService } from './i18n';
import { cleanErrorReason, normalizeError } from './errorNormalization';

describe('error normalization', () => {
  beforeEach(() => i18nService.setLanguage('zh', { persist: false }));

  test('maps common categories to Chinese', () => {
    expect(normalizeError(new Error('401 Unauthorized'))).toContain('登录状态');
    expect(normalizeError('request timed out')).toContain('超时');
    expect(normalizeError('permission denied')).toContain('权限');
    expect(normalizeError('MCP endpoint is invalid')).toContain('MCP');
  });

  test('preserves a safe reason for unknown errors', () => {
    expect(normalizeError('Widget could not be loaded')).toBe('操作失败：Widget could not be loaded');
  });

  test('classifies Chinese failures and sanitizes sensitive values', () => {
    expect(normalizeError('保存失败')).not.toContain('Operation failed');
    const result = normalizeError('文件读取失败：https://example.com/a C:\\Users\\me\\secret.json');
    expect(result).not.toContain('example.com');
    expect(result).not.toContain('secret.json');
  });

  test('removes markup, payloads, urls, paths and stacks', () => {
    const cleaned = cleanErrorReason('<b>Failed</b> https://secret.test/x {"token":"x"} C:\\Users\\me\\a.txt\n at internal.js');
    expect(cleaned).not.toContain('secret.test');
    expect(cleaned).not.toContain('token');
    expect(cleaned).not.toContain('internal.js');
  });
});
