import { describe, expect, it } from 'vitest';

import { PI_CUSTOM_TOOL_MAX_OUTPUT_CHARS, truncateToolTextHeadTail } from './piToolOutputLimit';

describe('truncateToolTextHeadTail', () => {
  it('returns short strings unchanged without truncation', () => {
    const input = 'hello\nworld';
    expect(truncateToolTextHeadTail(input, 100)).toEqual({
      text: input,
      truncated: false,
      omittedChars: 0,
    });
  });

  it('caps oversized text within maxChars while preserving head and tail', () => {
    const head = 'HEAD-START-' + 'a'.repeat(5_000);
    const middle = 'm'.repeat(150_000);
    const tail = 'b'.repeat(5_000) + '-TAIL-TRACEBACK';
    const input = head + middle + tail;

    const result = truncateToolTextHeadTail(input);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(PI_CUSTOM_TOOL_MAX_OUTPUT_CHARS);
    expect(result.text.startsWith('HEAD-START-')).toBe(true);
    expect(result.text.endsWith('-TAIL-TRACEBACK')).toBe(true);
    expect(result.omittedChars).toBeGreaterThan(100_000);
    expect(result.text).toContain('showing head and tail');
  });

  it('never splits UTF-16 surrogate pairs at head or tail boundaries', () => {
    const emojis = '🚀'.repeat(200);
    const result = truncateToolTextHeadTail(emojis, 251);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(251);
    // Verify well-formed UTF-16: no unpaired surrogates
    expect(result.text.toWellFormed()).toBe(result.text);
  });

  it('falls back cleanly when maxChars is smaller than the truncation marker', () => {
    const result = truncateToolTextHeadTail('abcdefghij'.repeat(10), 20);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(20);
  });
});
