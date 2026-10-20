import { afterEach, expect, test } from 'vitest';
import { i18nService } from './i18n';
import { neutralRuntimeName } from './runtimeNameNeutralizer';

afterEach(() => {
  i18nService.setLanguage('zh', { persist: false });
});

test('replaces the internal runtime name in both cases for Chinese copy', () => {
  i18nService.setLanguage('zh', { persist: false });
  expect(neutralRuntimeName('Magpie startup timed out')).toBe('本地模型服务 startup timed out');
  expect(neutralRuntimeName('magpie gateway unreachable')).toBe('本地模型服务 gateway unreachable');
});

test('uses the English neutral name for English copy', () => {
  i18nService.setLanguage('en', { persist: false });
  expect(neutralRuntimeName('Magpie process exited')).toBe('local model service process exited');
});

test('leaves neutral text unchanged', () => {
  i18nService.setLanguage('zh', { persist: false });
  expect(neutralRuntimeName('Unable to start the local model service')).toBe(
    'Unable to start the local model service',
  );
});
