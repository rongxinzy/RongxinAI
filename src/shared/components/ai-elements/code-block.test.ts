import { expect, test } from 'vitest';

import { normalizeCodeLanguage } from './code-block';

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
