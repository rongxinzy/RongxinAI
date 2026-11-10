import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  mockCreateAgentSession: vi.fn(),
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: hoisted.mockCreateAgentSession,
}));

import { safeSlice } from '../src/shared/lib/safeSlice';
import {
  truncateMcpContent,
  MCP_MAX_OUTPUT_CHARS,
  McpPiAdapter,
} from '../src/main/libs/agentEngine/mcpPiAdapter';
import {
  buildPiDocumentReaderTool,
  PI_DOCUMENT_READER_MAX_CHARS,
} from '../src/main/libs/agentEngine/piDocumentReaderTool';
import {
  buildPiSubagentTool,
  PI_SUBAGENT_MAX_OUTPUT_CHARS,
  type PiSubagentToolDeps,
} from '../src/main/libs/agentEngine/piSubagentTool';
import {
  PiMessageRole,
  PiSubagentEventType,
} from '../src/main/libs/agentEngine/piSubagentExecution';

describe('Adversarial Challenger Suite: safeSlice & Tool Truncation Bounds', () => {
  // Helper to assert no dangling high surrogate at end of string
  const assertNoDanglingHighSurrogate = (str: string, contextMsg = '') => {
    if (str.length === 0) return;
    const lastCode = str.charCodeAt(str.length - 1);
    expect(
      lastCode >= 0xd800 && lastCode <= 0xdbff,
      `Dangling high surrogate (0x${lastCode.toString(16)}) found at end of string: ${contextMsg}`,
    ).toBe(false);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. safeSlice Extensive Edge Case Matrix
  // ─────────────────────────────────────────────────────────────────────────────

  describe('safeSlice: Astral character positions relative to maxChars', () => {
    // '🚀' is \uD83D\uDE80 (high: 0xD83D, low: 0xDE80)
    it('handles emoji at maxChars - 2 (indices 8, 9 with maxChars=10) -> emoji fully preserved', () => {
      const text = 'abcdefgh' + '🚀' + 'xyz'; // 'abcdefgh' length=8, 🚀 indices 8,9, 'x' index 10
      const sliced = safeSlice(text, 10);
      expect(sliced).toBe('abcdefgh🚀');
      expect(sliced.length).toBe(10);
      assertNoDanglingHighSurrogate(sliced);
    });

    it('handles emoji at maxChars - 1 (indices 9, 10 with maxChars=10) -> high surrogate dropped cleanly', () => {
      const text = 'abcdefghi' + '🚀' + 'xyz'; // 'abcdefghi' length=9, 🚀 indices 9,10, 'x' index 11
      const sliced = safeSlice(text, 10);
      expect(sliced).toBe('abcdefghi');
      expect(sliced.length).toBe(9);
      assertNoDanglingHighSurrogate(sliced);
    });

    it('handles emoji at maxChars (indices 10, 11 with maxChars=10) -> emoji completely omitted', () => {
      const text = 'abcdefghij' + '🚀' + 'xyz'; // 'abcdefghij' length=10, 🚀 indices 10,11
      const sliced = safeSlice(text, 10);
      expect(sliced).toBe('abcdefghij');
      expect(sliced.length).toBe(10);
      assertNoDanglingHighSurrogate(sliced);
    });

    it('handles string of pure astral characters sliced at odd lengths', () => {
      // 10 rocket emojis = 20 UTF-16 code units
      const rockets = '🚀'.repeat(10);
      for (let len = 0; len <= 22; len++) {
        const sliced = safeSlice(rockets, len);
        assertNoDanglingHighSurrogate(sliced, `rockets sliced at ${len}`);
        if (len <= 0) {
          expect(sliced).toBe('');
        } else if (len >= 20) {
          expect(sliced).toBe(rockets);
        } else if (len % 2 === 1) {
          // Odd cut drops the half-emoji
          expect(sliced.length).toBe(len - 1);
        } else {
          // Even cut keeps full emojis
          expect(sliced.length).toBe(len);
        }
      }
    });

    it('handles multiple consecutive diverse astral characters (CJK ext, math, symbols)', () => {
      // 𠮷 (\uD842\uDFB7), 𪚥 (\uD869\uDEA5), 𝒜 (\uD835\uDC9C), 𝄞 (\uD834\uDD1E)
      const astralSeq = '𠮷𪚥𝒜𝄞'; // 8 code units
      for (let cut = 0; cut <= astralSeq.length + 2; cut++) {
        const sliced = safeSlice(astralSeq, cut);
        assertNoDanglingHighSurrogate(sliced, `astralSeq at cut ${cut}`);
      }
    });
  });

  describe('safeSlice: Complex multi-character sequences (skin tones, ZWJ)', () => {
    it('handles skin-tone modified emojis across all cut offsets', () => {
      // 👍🏽 = 👍 (\uD83D\uDC4D) + 🏽 (\uD83C\uDFFD) -> 4 code units
      const text = 'prefix-' + '👍🏽' + '-suffix'; // prefix- = 7 chars, 👍🏽 = 4 chars (7,8,9,10), -suffix = 7 chars
      for (let cut = 0; cut <= text.length; cut++) {
        const sliced = safeSlice(text, cut);
        assertNoDanglingHighSurrogate(sliced, `skin tone at cut ${cut}`);
      }

      // Cut at 8: includes prefix- and high surrogate of 👍 -> dropped to prefix- (7 chars)
      expect(safeSlice(text, 8)).toBe('prefix-');
      // Cut at 9: includes prefix- and full 👍 (9 chars)
      expect(safeSlice(text, 9)).toBe('prefix-👍');
      // Cut at 10: includes prefix-, full 👍, and high surrogate of 🏽 -> dropped to prefix-👍 (9 chars)
      expect(safeSlice(text, 10)).toBe('prefix-👍');
      // Cut at 11: includes prefix-, full 👍, and full 🏽 -> prefix-👍🏽 (11 chars)
      expect(safeSlice(text, 11)).toBe('prefix-👍🏽');
    });

    it('handles ZWJ family emoji 👨‍👩‍👧‍👦 across all cut offsets', () => {
      // 👨‍👩‍👧‍👦 is 11 code units: 👨(2) + ZWJ(1) + 👩(2) + ZWJ(1) + 👧(2) + ZWJ(1) + 👦(2)
      const family = '👨‍👩‍👧‍👦';
      expect(family.length).toBe(11);

      for (let cut = 0; cut <= family.length; cut++) {
        const sliced = safeSlice(family, cut);
        assertNoDanglingHighSurrogate(sliced, `family at cut ${cut}`);
      }

      // Cut at 1: drops high surrogate of 👨 -> ''
      expect(safeSlice(family, 1)).toBe('');
      // Cut at 2: keeps 👨
      expect(safeSlice(family, 2)).toBe('👨');
      // Cut at 3: keeps 👨 + ZWJ
      expect(safeSlice(family, 3)).toBe('👨\u200D');
      // Cut at 4: drops high surrogate of 👩 -> '👨\u200D'
      expect(safeSlice(family, 4)).toBe('👨\u200D');
      // Cut at 5: keeps 👨‍👩
      expect(safeSlice(family, 5)).toBe('👨\u200D👩');
    });

    it('handles flag sequences (regional indicator pairs) like 🇨🇳 and 🇺🇸', () => {
      // 🇨🇳 is 🇨 (\uD83C\uDDE8) + 🇳 (\uD83C\uDDF3) = 4 code units
      const flag = '🇨🇳';
      expect(flag.length).toBe(4);

      expect(safeSlice(flag, 1)).toBe('');
      expect(safeSlice(flag, 2)).toBe('🇨');
      expect(safeSlice(flag, 3)).toBe('🇨');
      expect(safeSlice(flag, 4)).toBe('🇨🇳');
    });
  });

  describe('safeSlice: Primitive & boundary conditions', () => {
    it('handles empty string with various maxChars', () => {
      expect(safeSlice('', -5)).toBe('');
      expect(safeSlice('', 0)).toBe('');
      expect(safeSlice('', 5)).toBe('');
      expect(safeSlice('', 100_000)).toBe('');
    });

    it('handles negative, zero, and infinite lengths', () => {
      expect(safeSlice('hello', -1)).toBe('');
      expect(safeSlice('hello', -100)).toBe('');
      expect(safeSlice('hello', 0)).toBe('');
      expect(safeSlice('hello', Number.NEGATIVE_INFINITY)).toBe('');
      expect(safeSlice('hello', Number.POSITIVE_INFINITY)).toBe('hello');
      expect(safeSlice('hello', Number.NaN)).toBe('');
    });

    it('handles maxChars exceeding string length', () => {
      expect(safeSlice('hello', 5)).toBe('hello');
      expect(safeSlice('hello', 6)).toBe('hello');
      expect(safeSlice('hello', 10_000)).toBe('hello');
    });

    it('handles non-integer maxChars gracefully', () => {
      // 3.7 -> index 2 is 'l', so slices 'hel'
      expect(safeSlice('hello', 3.7)).toBe('hel');
    });
  });
});
