import { describe, expect, test } from 'vitest';

import { inferFileExtension, resolveLanguage } from './language';

describe('resolveLanguage', () => {
  test('maps common aliases to their canonical CodeMirror language', () => {
    expect(resolveLanguage('js')?.name).toBe('JavaScript');
    expect(resolveLanguage('py')?.name).toBe('Python');
    expect(resolveLanguage('yml')?.name).toBe('YAML');
    expect(resolveLanguage('bash')?.name).toBe('Shell');
    expect(resolveLanguage('tsx')?.name).toBe('TSX');
  });

  test('resolves canonical names directly', () => {
    expect(resolveLanguage('typescript')?.name).toBe('TypeScript');
  });

  test('is case-insensitive', () => {
    expect(resolveLanguage('Python')?.name).toBe('Python');
  });

  test('returns null for unknown languages', () => {
    expect(resolveLanguage('not-a-real-language')).toBeNull();
  });

  test('falls back to the raw name when the canonical alias misses', () => {
    // 'tf' maps to 'hcl', which this language-data version does not expose;
    // the raw-name fallback also misses, so the result is null.
    expect(resolveLanguage('tf')).toBeNull();
  });
});

describe('inferFileExtension', () => {
  test('maps common languages to file extensions', () => {
    expect(inferFileExtension('typescript')).toBe('ts');
    expect(inferFileExtension('tsx')).toBe('tsx');
    expect(inferFileExtension('python')).toBe('py');
    expect(inferFileExtension('rust')).toBe('rs');
    expect(inferFileExtension('shell')).toBe('sh');
    expect(inferFileExtension('dockerfile')).toBe('dockerfile');
    expect(inferFileExtension('c++')).toBe('cpp');
  });

  test('is case-insensitive', () => {
    expect(inferFileExtension('Python')).toBe('py');
    expect(inferFileExtension('C++')).toBe('cpp');
  });

  test('falls back to the lowercased language string', () => {
    expect(inferFileExtension('UnknownLang')).toBe('unknownlang');
  });

  test('returns txt when no language is provided', () => {
    expect(inferFileExtension(null)).toBe('txt');
    expect(inferFileExtension('')).toBe('txt');
  });
});
