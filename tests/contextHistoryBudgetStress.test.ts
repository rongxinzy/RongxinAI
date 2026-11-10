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

import {
  calculatePiConversationHistoryCharLimit,
  buildPiConversationPrompt,
} from '../src/main/libs/agentEngine/piConversationContext';
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
import { PiSubagentProfileId } from '../src/main/libs/agentEngine/piSubagentConstants';
import {
  PiMessageRole,
  PiSubagentEventType,
} from '../src/main/libs/agentEngine/piSubagentExecution';
import type { CoworkMessage } from '../src/main/coworkStore';
import type { McpServerManager } from '../src/main/mcpServerManager';

describe('Adversarial Stress Harness: Context Calculations & Truncation Bounds', () => {
  const makeMsg = (id: string, role: 'user' | 'assistant', text: string): CoworkMessage => ({
    id,
    conversation_id: 'test-convo',
    user_id: 'test-user',
    sender: role,
    text,
    created_at: new Date().toISOString(),
    metadata: null,
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. calculatePiConversationHistoryCharLimit & resolveHistoryBudget Stress Matrix
  // ─────────────────────────────────────────────────────────────────────────────

  describe('calculatePiConversationHistoryCharLimit Boundary Matrix', () => {
    const boundaryContextWindows = [
      0,
      -1,
      -100,
      -32_768,
      512,
      1_024,
      2_048,
      4_096,
      8_192,
      16_384,
      32_768,
      65_536,
      128_000,
      200_000,
      1_000_000,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];

    const boundaryOutputTokens = [
      undefined,
      0,
      -1,
      -1_024,
      -4_096,
      512,
      1_024,
      2_048,
      4_096,
      8_192,
      16_384,
      128_000,
      2_000_000, // Exceeds all realistic context windows
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];

    it('guarantees finite, non-NaN, positive integer results >= 2000 across all matrix combinations', () => {
      let testCount = 0;
      for (const ctx of boundaryContextWindows) {
        for (const out of boundaryOutputTokens) {
          testCount++;
          const limit = calculatePiConversationHistoryCharLimit(ctx, out);

          // 1. No NaN
          expect(Number.isNaN(limit), `NaN returned for ctx=${ctx}, out=${out}`).toBe(false);

          // 2. Finite (no Infinity or -Infinity)
          expect(Number.isFinite(limit), `Non-finite returned for ctx=${ctx}, out=${out}`).toBe(
            true,
          );

          // 3. Strictly positive integer
          expect(Number.isInteger(limit), `Non-integer returned for ctx=${ctx}, out=${out}`).toBe(
            true,
          );
          expect(limit, `Limit must be >= 2000 for ctx=${ctx}, out=${out}`).toBeGreaterThanOrEqual(
            2_000,
          );

          // 4. Respects upper bound cap
          const effectiveCtx = Number.isFinite(ctx) && ctx > 0 ? ctx : 32_768;
          const maxAllowedCap = Math.max(60_000, Math.floor(effectiveCtx * 2));
          expect(limit, `Limit exceeds ceiling for ctx=${ctx}, out=${out}`).toBeLessThanOrEqual(
            maxAllowedCap,
          );
        }
      }
      expect(testCount).toBe(boundaryContextWindows.length * boundaryOutputTokens.length);
    });

    it('monotonically scales history budget with context window for standard output sizes', () => {
      const fixedOutput = 4_096;
      const monotonicContexts = [16_384, 32_768, 65_536, 128_000, 200_000, 1_000_000];
      let previousLimit = 0;
      for (const ctx of monotonicContexts) {
        const limit = calculatePiConversationHistoryCharLimit(ctx, fixedOutput);
        expect(limit).toBeGreaterThan(previousLimit);
        previousLimit = limit;
      }
    });

    it('scales reservedPromptTokens proportionally so small models never enter negative availableTokens', () => {
      // 512 context: reservedPromptTokens = 512 * 0.25 = 128. availableTokens = Math.max(1, 512 - 4096 - 128) = 1.
      expect(calculatePiConversationHistoryCharLimit(512, 4_096)).toBe(2_000);
      // 1024 context: reservedPromptTokens = 256. availableTokens = Math.max(1, 1024 - 4096 - 256) = 1.
      expect(calculatePiConversationHistoryCharLimit(1_024, 4_096)).toBe(2_000);
      // 8192 context: reservedPromptTokens = 2048. availableTokens = Math.max(1, 8192 - 2048 - 2048) = 4096.
      // chars = 4096 * 0.5 = 2048 chars.
      expect(calculatePiConversationHistoryCharLimit(8_192, 2_048)).toBe(2_048);
    });
  });

  describe('resolveHistoryBudget Behavior via buildPiConversationPrompt', () => {
    const makeMsg = (id: string, type: CoworkMessage['type'], content: string): CoworkMessage => ({
      id,
      type,
      content,
      timestamp: Date.now(),
    });

    it('enforces entry budget and total budget bounds under extreme maxChars values', () => {
      const boundaryMaxChars = [
        0,
        -1,
        -50_000,
        100, // Lower than floor (2,000)
        1_000,
        2_000, // Exact floor
        10_000,
        60_000, // Default ceiling
        120_000,
        500_000,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ];

      for (const maxChars of boundaryMaxChars) {
        // Create 20 large messages of 10,000 chars each
        const messages = Array.from({ length: 20 }, (_, i) =>
          makeMsg(`m-${i}`, 'user', `Message-${i}: ${'A'.repeat(10_000)}`),
        );
        const prompt = buildPiConversationPrompt(messages, 'User prompt.', { maxChars });

        expect(prompt).toContain('User prompt.');
        expect(prompt).toContain('=== PREVIOUS CONVERSATION');
        expect(prompt).toContain('[truncated]');

        // Total chars must never be infinite or NaN
        expect(Number.isFinite(prompt.length)).toBe(true);

        if (typeof maxChars === 'number' && Number.isFinite(maxChars) && maxChars > 0) {
          const effectiveTotal = Math.max(2_000, Math.floor(maxChars));
          // Prompt length can exceed totalChars slightly due to headers and currentPrompt,
          // but history entries alone must be <= totalChars.
          expect(prompt.length).toBeLessThan(effectiveTotal + 500);
        } else {
          // Fallback is 60,000 chars
          expect(prompt.length).toBeLessThan(60_000 + 500);
        }
      }
    });

    it('preserves history entries in correct chronological order after budget truncation', () => {
      // 50 messages of ~130 chars each = ~6500 chars, exceeding 3,000 budget
      const messages = Array.from({ length: 50 }, (_, i) =>
        makeMsg(
          `m-${i}`,
          'user',
          `Step-${i.toString().padStart(3, '0')}: evidence ${i} ${'X'.repeat(100)}`,
        ),
      );
      const prompt = buildPiConversationPrompt(messages, 'Finish.', { maxChars: 3_000 });

      // Must include latest messages
      expect(prompt).toContain('Step-049');
      expect(prompt).toContain('Step-048');
      // Earliest messages must have been dropped to satisfy the 3,000 char budget
      expect(prompt).not.toContain('Step-000');
      expect(prompt).not.toContain('Step-001');

      // Verify chronological ordering of preserved messages
      const idx48 = prompt.indexOf('Step-048');
      const idx49 = prompt.indexOf('Step-049');
      expect(idx48).toBeLessThan(idx49);
    });
  });
});
