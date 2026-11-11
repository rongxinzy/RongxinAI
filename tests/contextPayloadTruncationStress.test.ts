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
import type { McpServerManager } from '../src/main/libs/mcpServerManager';

describe('Adversarial Stress Harness: Payload Truncation Bounds', () => {
  // 2. Truncation Stress Harness on Large Payloads (100KB, 500KB, 2MB)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('mcpPiAdapter truncateMcpContent Stress Tests (100KB, 500KB, 2MB)', () => {
    const payloads = [
      { label: '100KB payload', size: 102_400 },
      { label: '500KB payload', size: 512_000 },
      { label: '2MB payload', size: 2_097_152 },
    ];

    for (const { label, size } of payloads) {
      it(`strictly truncates single ${label} to MCP_MAX_OUTPUT_CHARS (${MCP_MAX_OUTPUT_CHARS})`, () => {
        const rawString = 'M'.repeat(size);
        const input = [{ type: 'text', text: rawString }];

        const result = truncateMcpContent(input);

        // 1. Flag must be true
        expect(result.truncated).toBe(true);

        // 2. Content array preserved
        expect(result.content).toHaveLength(1);
        const itemText = result.content[0].text!;

        // 3. Notice must be present with accurate total
        expect(itemText).toContain(
          `[MCP tool output truncated to ${MCP_MAX_OUTPUT_CHARS.toLocaleString()} characters (total: ${size.toLocaleString()} characters)]`,
        );

        // 4. Exact prefix preserved
        expect(itemText.startsWith('M'.repeat(MCP_MAX_OUTPUT_CHARS))).toBe(true);

        // 5. Total text length strictly capped at MCP_MAX_OUTPUT_CHARS + notice length
        expect(itemText.length).toBeLessThan(MCP_MAX_OUTPUT_CHARS + 200);
      });
    }

    it('handles multi-item payloads totaling 2MB across heterogeneous blocks', () => {
      const part1 = 'A'.repeat(10_000);
      const part2 = 'B'.repeat(40_000); // Exceeds remaining 20,000 budget
      const part3 = 'C'.repeat(2_000_000); // 2MB block when budget is already 0

      const input = [
        { type: 'text', text: part1 },
        { type: 'image', data: 'binary_data_preserved' },
        { type: 'text', text: part2 },
        { type: 'text', text: part3 },
      ];

      const result = truncateMcpContent(input);

      expect(result.truncated).toBe(true);
      expect(result.content).toHaveLength(4);

      // Part 1: intact
      expect(result.content[0].text).toBe(part1);

      // Non-text: intact
      expect(result.content[1]).toEqual({ type: 'image', data: 'binary_data_preserved' });

      // Part 2: sliced to remaining 20,000 + notice
      const text2 = result.content[2].text!;
      expect(text2.startsWith('B'.repeat(20_000))).toBe(true);
      expect(text2).toContain(`(total: 40,000 characters)`);

      // Part 3: sliced to 0 + notice
      const text3 = result.content[3].text!;
      expect(text3.startsWith('\n\n[MCP tool output truncated')).toBe(true);
      expect(text3).toContain(`(total: 2,000,000 characters)`);
    });

    it('end-to-end McpPiAdapter.buildGatewayTool executes and truncates 2MB result', async () => {
      const twoMegString = 'X'.repeat(2_097_152);
      const mockManager = {
        toolManifest: [
          {
            server: 'bigdata',
            name: 'query_logs',
            description: 'Returns huge log dump',
            inputSchema: { type: 'object' },
          },
        ],
        serverStatuses: [{ name: 'bigdata', connected: true, toolCount: 1 }],
        callTool: vi.fn(async () => ({
          content: [{ type: 'text', text: twoMegString }],
          isError: false,
        })),
      } as unknown as McpServerManager;

      const tool = new McpPiAdapter(mockManager).buildGatewayTool();
      expect(tool).not.toBeNull();

      const result = await (
        tool as {
          execute: (
            id: string,
            params: Record<string, unknown>,
          ) => Promise<{
            content: Array<{ type: string; text?: string }>;
            details: { truncated?: boolean; isError?: boolean };
          }>;
        }
      ).execute('call-1', { tool: 'query_logs' });

      expect(result.details.truncated).toBe(true);
      expect(result.content[0].text).toContain(
        `[MCP tool output truncated to ${MCP_MAX_OUTPUT_CHARS.toLocaleString()} characters (total: 2,097,152 characters)]`,
      );
      expect(result.content[0].text!.length).toBeLessThan(MCP_MAX_OUTPUT_CHARS + 200);
    });
  });

  describe('piDocumentReaderTool Stress Tests (100KB, 500KB, 2MB DOCX files)', () => {
    let tempDir: string;

    beforeAll(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-reader-stress-'));
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

    const docPayloads = [
      { file: 'doc_100k.docx', size: 102_400 },
      { file: 'doc_500k.docx', size: 512_000 },
      { file: 'doc_2m.docx', size: 2_097_152 },
    ];

    for (const { file, size } of docPayloads) {
      it(`truncates ${file} (${(size / 1024).toFixed(0)}KB) strictly to PI_DOCUMENT_READER_MAX_CHARS (${PI_DOCUMENT_READER_MAX_CHARS})`, async () => {
        const filePath = path.join(tempDir, file);
        await createDocx(filePath, 'D'.repeat(size));

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

        // 1. Details truncation flag
        expect(result.details.truncated).toBe(true);
        expect(result.details.markdownCharacters).toBeGreaterThanOrEqual(size);

        // 2. Header notification present
        const text = result.content[0].text;
        expect(text).toContain(
          `Output truncated to ${PI_DOCUMENT_READER_MAX_CHARS.toLocaleString()} characters`,
        );

        // 3. Body strictly sliced
        expect(text.endsWith('D'.repeat(100))).toBe(true);

        // 4. Bounded overall length (80k body + header < 81k)
        expect(text.length).toBeLessThan(PI_DOCUMENT_READER_MAX_CHARS + 500);
      });
    }
  });

  describe('piSubagentTool Stress Tests (100KB, 500KB, 2MB Outputs)', () => {
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

    const subagentPayloads = [
      { label: '100KB output', size: 102_400 },
      { label: '500KB output', size: 512_000 },
      { label: '2MB output', size: 2_097_152 },
    ];

    for (const { label, size } of subagentPayloads) {
      it(`strictly truncates single subagent ${label} to PI_SUBAGENT_MAX_OUTPUT_CHARS (${PI_SUBAGENT_MAX_OUTPUT_CHARS})`, async () => {
        const bigOutput = 'S'.repeat(size);
        const mockSession = createMockSession(bigOutput);

        hoisted.mockCreateAgentSession.mockResolvedValueOnce({
          session: mockSession,
        });

        const tool = buildSubagentTool();
        const result = await tool.execute('call-sub', { agent: 'scout', task: 'Run big task' });

        // 1. Details truncation flag
        expect(result.details.truncated).toBe(true);

        // 2. Notice present with accurate total
        const text = result.content[0].text;
        expect(text).toContain(
          `[Subagent output truncated to ${PI_SUBAGENT_MAX_OUTPUT_CHARS.toLocaleString()} characters (total: ${size.toLocaleString()} characters)]`,
        );

        // 3. Body prefix preserved
        expect(text.startsWith('S'.repeat(PI_SUBAGENT_MAX_OUTPUT_CHARS))).toBe(true);

        // 4. Total text length strictly capped
        expect(text.length).toBeLessThan(PI_SUBAGENT_MAX_OUTPUT_CHARS + 200);
      });
    }

    it('empirically characterizes chain execution output cap under 300KB intermediate step', async () => {
      const step1Oversized = 'C'.repeat(300_000);
      const step2Output = 'Final synthesis complete.';

      let promptCounter = 0;
      let step2ReceivedTask = '';

      const session1 = {
        prompt: vi.fn(async () => {
          session1.emit({
            type: PiSubagentEventType.MessageEnd,
            message: { role: PiMessageRole.Assistant, content: step1Oversized, stopReason: 'stop' },
          });
          session1.emit({ type: PiSubagentEventType.AgentSettled });
        }),
        abort: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn((listener: (event: unknown) => void) => {
          session1.listeners.push(listener);
          return () => {};
        }),
        listeners: [] as Array<(event: unknown) => void>,
        emit: (event: unknown) => {
          for (const l of session1.listeners) l(event);
        },
      };

      const session2 = {
        prompt: vi.fn(async (taskText: string) => {
          step2ReceivedTask = taskText || '';
          session2.emit({
            type: PiSubagentEventType.MessageEnd,
            message: { role: PiMessageRole.Assistant, content: step2Output, stopReason: 'stop' },
          });
          session2.emit({ type: PiSubagentEventType.AgentSettled });
        }),
        abort: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn((listener: (event: unknown) => void) => {
          session2.listeners.push(listener);
          return () => {};
        }),
        listeners: [] as Array<(event: unknown) => void>,
        emit: (event: unknown) => {
          for (const l of session2.listeners) l(event);
        },
      };

      hoisted.mockCreateAgentSession.mockImplementation(async () => {
        promptCounter++;
        if (promptCounter === 1) return { session: session1 };
        return { session: session2 };
      });

      const tool = buildSubagentTool();
      const result = await tool.execute('call-chain', {
        chain: [
          { agent: 'scout', task: 'Generate huge data' },
          { agent: 'planner', task: 'Summarize {previous}' },
        ],
      });

      // Verification of chain-level bounds:
      // 1. Both subagent sessions were invoked in sequence
      expect(promptCounter).toBe(2);

      // 2. The final result returned by subagent tool is strictly capped at PI_SUBAGENT_MAX_OUTPUT_CHARS
      expect(result.details.truncated).toBe(true);
      expect(result.content[0].text.length).toBeLessThan(PI_SUBAGENT_MAX_OUTPUT_CHARS + 200);
      expect(result.content[0].text).toContain(
        `[Subagent output truncated to ${PI_SUBAGENT_MAX_OUTPUT_CHARS.toLocaleString()} characters`,
      );

      // 3. Empirical behavior observation:
      // Note that in chain mode, Step 1's 300,000 raw output was passed into Step 2 via {previous}
      // and sections.join() total length reached 300,063 before being sliced by textResult to 50,000.
      expect(step2ReceivedTask.length).toBeGreaterThan(250_000);
    });
  });
});
