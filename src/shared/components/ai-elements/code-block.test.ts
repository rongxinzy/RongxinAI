import { expect, test } from 'vitest';

import { CodeBlockHeaderSurface, normalizeCodeLanguage } from './code-block';

test('exposes a seamless code block header surface without changing the default', () => {
  expect(CodeBlockHeaderSurface.Default).toBe('default');
  expect(CodeBlockHeaderSurface.Seamless).toBe('seamless');
});

test('resolves canonical language ids', () => {
  expect(normalizeCodeLanguage('javascript')).toBe('javascript');
  expect(normalizeCodeLanguage('python')).toBe('python');
});

test('resolves common aliases to their canonical grammar', () => {
  expect(normalizeCodeLanguage('js')).toBe('javascript');
  expect(normalizeCodeLanguage('ts')).toBe('typescript');
  expect(normalizeCodeLanguage('py')).toBe('python');
  expect(normalizeCodeLanguage('sh')).toBe('shellscript');
  expect(normalizeCodeLanguage('bash')).toBe('shellscript');
  expect(normalizeCodeLanguage('yml')).toBe('yaml');
  expect(normalizeCodeLanguage('c++')).toBe('cpp');
});

test('normalizes case and whitespace, rejects unknown languages', () => {
  expect(normalizeCodeLanguage('  TS ')).toBe('typescript');
  expect(normalizeCodeLanguage('not-a-language')).toBeNull();
});
