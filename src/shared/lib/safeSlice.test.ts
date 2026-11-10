import { describe, expect, it } from 'vitest';
import { safeSlice } from './safeSlice';

describe('safeSlice', () => {
  it('returns original string when length is within maxChars', () => {
    expect(safeSlice('hello world', 20)).toBe('hello world');
    expect(safeSlice('hello world', 11)).toBe('hello world');
  });

  it('slices normal ASCII cleanly', () => {
    expect(safeSlice('hello world', 5)).toBe('hello');
  });

  it('slices BMP CJK characters cleanly', () => {
    expect(safeSlice('你好世界测试', 4)).toBe('你好世界');
  });

  it('prevents splitting surrogate pair when boundary lands on high surrogate', () => {
    // '🚀' is \uD83D\uDE80 (2 UTF-16 code units: 55296, 56960)
    const text = 'hello🚀world'; // indices: 0..4='hello', 5=\uD83D, 6=\uDE80, 7='w'
    // Cutting at 6 code units would include \uD83D without \uDE80
    const sliced = safeSlice(text, 6);
    expect(sliced).toBe('hello');
    expect(sliced.length).toBe(5);
    expect(sliced.charCodeAt(sliced.length - 1)).not.toBeGreaterThanOrEqual(0xd800);
  });

  it('keeps full surrogate pair when boundary includes low surrogate', () => {
    const text = 'hello🚀world';
    expect(safeSlice(text, 7)).toBe('hello🚀');
  });

  it('handles rare CJK extension surrogate pair (e.g. 𠮷 U+20BB7)', () => {
    const text = 'prefix𠮷suffix'; // 𠮷 is \uD842\uDFB7
    // 'prefix' is 6 chars. 𠮷 is indices 6 and 7.
    expect(safeSlice(text, 7)).toBe('prefix');
    expect(safeSlice(text, 8)).toBe('prefix𠮷');
  });

  it('handles edge cases: maxChars <= 0 and empty string', () => {
    expect(safeSlice('', 10)).toBe('');
    expect(safeSlice('test', 0)).toBe('');
    expect(safeSlice('test', -5)).toBe('');
    expect(safeSlice('🚀', 1)).toBe('');
  });
});
