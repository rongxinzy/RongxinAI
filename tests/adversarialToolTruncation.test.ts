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
import type { McpServerManager } from '../src/main/mcpServerManager';

describe('Adversarial Challenger Suite: Tool Truncation Bounds', () => {
  const assertNoDanglingHighSurrogate = (str: string, contextMsg = '') => {
    if (str.length === 0) return;
    const lastCode = str.charCodeAt(str.length - 1);
    expect(
      lastCode >= 0xd800 && lastCode <= 0xdbff,
      `Dangling high surrogate (0x${lastCode.toString(16)}) found at end of string: ${contextMsg}`,
    ).toBe(false);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Tool Truncation Stress Testing: 100KB, 500KB, 2MB inputs
  // ─────────────────────────────────────────────────────────────────────────────

  describe('mcpPiAdapter Truncation Stress Testing (100KB, 500KB, 2MB)', () => {
    const sizes = [
      { name: '100KB', chars: 100_000 },
      { name: '500KB', chars: 500_000 },
      { name: '2MB', chars: 2_000_000 },
    ];

    for (const { name, chars } of sizes) {
      it(`truncates ${name} CJK text cleanly without exceeding bound or surrogate issues`, () => {
        // CJK text: "知远智能体上下文窗口排查测试" repeated
        const cjkChunk = '知远智能体上下文窗口排查测试';
        const rawText = cjkChunk.repeat(Math.ceil(chars / cjkChunk.length)).slice(0, chars);
        expect(rawText.length).toBe(chars);

        const result = truncateMcpContent([{ type: 'text', text: rawText }]);
        expect(result.truncated).toBe(true);
        expect(result.content).toHaveLength(1);

        const text = result.content[0].text!;
        assertNoDanglingHighSurrogate(text, `MCP ${name} CJK`);
        expect(text).toContain(
          `[MCP tool output truncated to ${MCP_MAX_OUTPUT_CHARS.toLocaleString()} characters`,
        );
        expect(text).toContain(`(total: ${chars.toLocaleString()} characters)`);
        expect(text.length).toBeLessThan(MCP_MAX_OUTPUT_CHARS + 200);
      });

      it(`truncates ${name} Astral Plane emojis with surrogate boundary right at limit`, () => {
        // Build string where character right at index MCP_MAX_OUTPUT_CHARS - 1 is a high surrogate
        const prefix = 'A'.repeat(MCP_MAX_OUTPUT_CHARS - 1);
        const emojiTail = '🚀'.repeat(Math.ceil((chars - prefix.length) / 2));
        const rawText = (prefix + emojiTail).slice(0, chars);

        // Index MCP_MAX_OUTPUT_CHARS - 1 is \uD83D (high surrogate of 🚀)
        expect(rawText.charCodeAt(MCP_MAX_OUTPUT_CHARS - 1)).toBeGreaterThanOrEqual(0xd800);
        expect(rawText.charCodeAt(MCP_MAX_OUTPUT_CHARS - 1)).toBeLessThanOrEqual(0xdbff);

        const result = truncateMcpContent([{ type: 'text', text: rawText }]);
        expect(result.truncated).toBe(true);

        const text = result.content[0].text!;
        assertNoDanglingHighSurrogate(text, `MCP ${name} Astral boundary`);
        // The sliced prefix should have dropped the dangling surrogate
        expect(text.startsWith(prefix)).toBe(true);
        expect(text.length).toBeLessThan(MCP_MAX_OUTPUT_CHARS + 200);
      });
    }

    it('stress-tests multi-item heterogeneous payload totaling 2MB', () => {
      const items: Array<{ type: string; text?: string; data?: string }> = [];
      // 20 items of 100KB each = 2MB
      for (let i = 0; i < 20; i++) {
        items.push({ type: 'text', text: `Item-${i}: `.padEnd(100_000, `x${i}`) });
      }

      const result = truncateMcpContent(items);
      expect(result.truncated).toBe(true);
      expect(result.content).toHaveLength(20);

      // Total characters across all text items must be strictly bounded
      let totalTextChars = 0;
      for (const item of result.content) {
        if (item.text) {
          totalTextChars += item.text.length;
          assertNoDanglingHighSurrogate(item.text, 'multi-item MCP text');
        }
      }
      // First item truncated to 30,000 + notice (~100), remaining 19 items have 0 + notice (~100 each)
      // Total text chars should not blow up
      expect(totalTextChars).toBeLessThan(MCP_MAX_OUTPUT_CHARS + 20 * 200);
    });
  });

  describe('piDocumentReaderTool Truncation Stress Testing (100KB, 500KB, 2MB)', () => {
    let tempDir: string;

    beforeAll(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-reader-challenger-'));
    });

    afterAll(() => {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    const createDocx = async (filePath: string, textContent: string): Promise<void> => {
      const archive = new JSZip();
      archive.file(
        '[Content_Types].xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
      );
      archive.file(
        '_rels/.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
      );
      archive.file(
        'word/document.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${textContent}</w:t></w:r></w:p></w:body>
</w:document>`,
      );
      fs.writeFileSync(filePath, await archive.generateAsync({ type: 'nodebuffer' }));
    };

    const docxTests = [
      { name: '100KB DOCX', size: 100_000, file: 'test_100k.docx' },
      { name: '500KB DOCX', size: 500_000, file: 'test_500k.docx' },
      { name: '2MB DOCX', size: 2_000_000, file: 'test_2m.docx' },
    ];

    for (const { name, size, file } of docxTests) {
      it(`truncates ${name} accurately to PI_DOCUMENT_READER_MAX_CHARS (30,000) without surrogate corruption`, async () => {
        const filePath = path.join(tempDir, file);
        // Create text with astral emojis around the 30k boundary
        const prefix = '知远文档测试'.repeat(Math.floor(29_998 / 6)); // ~29,994 chars
        const filler = 'A'.repeat(PI_DOCUMENT_READER_MAX_CHARS - prefix.length - 1);
        const astralTail = '🚀'.repeat(Math.ceil((size - 30_000) / 2));
        const fullContent = (prefix + filler + astralTail).slice(0, size);

        await createDocx(filePath, fullContent);

        const tool = buildPiDocumentReaderTool({ workspaceRoot: tempDir }) as {
          execute: (
            id: string,
            params: { path: string },
          ) => Promise<{
            content: Array<{ text: string }>;
            details: { truncated: boolean; markdownCharacters: number };
          }>;
        };

        const result = await tool.execute('call-doc', { path: file });

        expect(result.details.truncated).toBe(true);
        expect(result.details.markdownCharacters).toBeGreaterThanOrEqual(size);

        const text = result.content[0].text;
        expect(text).toContain(
          `Output truncated to ${PI_DOCUMENT_READER_MAX_CHARS.toLocaleString()} characters`,
        );
        assertNoDanglingHighSurrogate(text, `DOCX ${name}`);
        expect(text.length).toBeLessThan(PI_DOCUMENT_READER_MAX_CHARS + 600);
      });
    }
  });

  describe('piSubagentTool Truncation Stress Testing (100KB, 500KB, 2MB)', () => {
    const buildSubagentTool = () => {
      const deps: PiSubagentToolDeps = {
        getPiAgentsDir: () => '/nonexistent-pi-agents',
        presetId: undefined,
        resolvedModel: {
          model: { provider: 'test', id: 'test-model' },
          modelRuntime: null,
          maxOutputTokens: 4096,
        },
        workspaceRoot: '/tmp/workspace',
        createPiResourceLoader: vi.fn(async () => ({})),
      };
      const tool = buildPiSubagentTool(deps);
      expect(tool).not.toBeNull();
      return tool as {
        execute: (
          id: string,
          params: Record<string, unknown>,
        ) => Promise<{
          content: Array<{ type: string; text: string }>;
          details: { truncated?: boolean };
        }>;
      };
    };

    const createMockSession = (output: string) => {
      const listeners: Array<(event: unknown) => void> = [];
      const session = {
        prompt: vi.fn(async () => {
          session.emit({
            type: PiSubagentEventType.MessageEnd,
            message: { role: PiMessageRole.Assistant, content: output, stopReason: 'stop' },
          });
          session.emit({ type: PiSubagentEventType.AgentSettled });
        }),
        steer: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn((listener: (event: unknown) => void) => {
          listeners.push(listener);
          return () => {};
        }),
        emit: (event: unknown) => {
          for (const listener of listeners) listener(event);
        },
      };
      return session;
    };

    const subagentSizes = [
      { name: '100KB', size: 100_000 },
      { name: '500KB', size: 500_000 },
      { name: '2MB', size: 2_000_000 },
    ];

    for (const { name, size } of subagentSizes) {
      it(`single mode: strictly truncates ${name} subagent output to PI_SUBAGENT_MAX_OUTPUT_CHARS (30,000)`, async () => {
        // Place an astral emoji right on the cut boundary (index 29,999)
        const prefix = 'S'.repeat(PI_SUBAGENT_MAX_OUTPUT_CHARS - 1);
        const astralPayload = (prefix + '🚀'.repeat(Math.ceil((size - prefix.length) / 2))).slice(
          0,
          size,
        );

        hoisted.mockCreateAgentSession.mockResolvedValueOnce({
          session: createMockSession(astralPayload),
        });

        const tool = buildSubagentTool();
        const result = await tool.execute('call-sub', { agent: 'scout', task: `Run ${name}` });

        expect(result.details.truncated).toBe(true);
        const text = result.content[0].text;
        assertNoDanglingHighSurrogate(text, `Subagent single ${name}`);
        expect(text).toContain(
          `[Subagent output truncated to ${PI_SUBAGENT_MAX_OUTPUT_CHARS.toLocaleString()} characters (total: ${size.toLocaleString()} characters)]`,
        );
        expect(text.length).toBeLessThan(PI_SUBAGENT_MAX_OUTPUT_CHARS + 200);
      });
    }

    it('parallel mode: aggregates multiple 500KB subagent outputs and strictly bounds final text', async () => {
      const payload500k = 'P'.repeat(500_000);
      hoisted.mockCreateAgentSession.mockImplementation(async () => ({
        session: createMockSession(payload500k),
      }));

      const tool = buildSubagentTool();
      const result = await tool.execute('call-parallel', {
        parallel: [
          { agent: 'scout', task: 'Task 1' },
          { agent: 'planner', task: 'Task 2' },
          { agent: 'reviewer', task: 'Task 3' },
        ],
      });

      expect(result.details.truncated).toBe(true);
      const text = result.content[0].text;
      assertNoDanglingHighSurrogate(text, 'Subagent parallel aggregate');
      expect(text.length).toBeLessThan(PI_SUBAGENT_MAX_OUTPUT_CHARS + 200);
      expect(text).toContain(
        `[Subagent output truncated to ${PI_SUBAGENT_MAX_OUTPUT_CHARS.toLocaleString()} characters`,
      );
    });

    it('chain mode: handles 2MB output from chain steps and strictly bounds final returned text', async () => {
      const payload2m = 'C'.repeat(2_000_000);
      hoisted.mockCreateAgentSession.mockImplementation(async () => ({
        session: createMockSession(payload2m),
      }));

      const tool = buildSubagentTool();
      const result = await tool.execute('call-chain', {
        chain: [
          { agent: 'scout', task: 'Step 1: produce massive logs' },
          { agent: 'planner', task: 'Step 2: summarize {previous}' },
        ],
      });

      expect(result.details.truncated).toBe(true);
      const text = result.content[0].text;
      assertNoDanglingHighSurrogate(text, 'Subagent chain aggregate');
      expect(text.length).toBeLessThan(PI_SUBAGENT_MAX_OUTPUT_CHARS + 200);
      expect(text).toContain(
        `[Subagent output truncated to ${PI_SUBAGENT_MAX_OUTPUT_CHARS.toLocaleString()} characters`,
      );
    });
  });
});
