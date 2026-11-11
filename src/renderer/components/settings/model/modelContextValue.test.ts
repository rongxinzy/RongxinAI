import { describe, expect, it } from 'vitest';
import { formatContextTokens, parseContextTokens } from './modelContextValue';

describe('parseContextTokens', () => {
  it('reads plain token counts and the binary shorthand shown next to the field', () => {
    expect(parseContextTokens('65536')).toEqual({ ok: true, value: 65536 });
    expect(parseContextTokens('64k')).toEqual({ ok: true, value: 65536 });
    expect(parseContextTokens('1m')).toEqual({ ok: true, value: 1048576 });
    expect(parseContextTokens('1.5k')).toEqual({ ok: true, value: 1536 });
    expect(parseContextTokens(' 64_000 ')).toEqual({ ok: true, value: 64000 });
  });

  it('treats blank as "not declared"', () => {
    expect(parseContextTokens('')).toEqual({ ok: true, value: undefined });
    expect(parseContextTokens('   ')).toEqual({ ok: true, value: undefined });
  });

  it('rejects malformed, zero and oversized values', () => {
    expect(parseContextTokens('64kb')).toEqual({ ok: false });
    expect(parseContextTokens('0')).toEqual({ ok: false });
    expect(parseContextTokens('-1')).toEqual({ ok: false });
    expect(parseContextTokens('100000001')).toEqual({ ok: false });
  });
});

describe('formatContextTokens', () => {
  it('reads back a plain integer so 64k never looks ambiguous', () => {
    expect(formatContextTokens(65536)).toBe('65536');
    expect(formatContextTokens(undefined)).toBe('');
  });
});
