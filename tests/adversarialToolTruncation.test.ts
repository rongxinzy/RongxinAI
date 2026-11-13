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

describe('Adversarial Challenger Suite: Tool Truncation Bounds', () => {
  const assertNoDanglingHighSurrogate = (str: string, contextMsg = '') => {
    if (str.length === 0) return;
    const lastCode = str.charCodeAt(str.length - 1);
    expect(
      lastCode >= 0xd800 && lastCode <= 0xdbff,
      `Dangling high surrogate (0x${lastCode.toString(16)}) found at end of string: ${contextMsg}`,
    ).toBe(false);
  };

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
  });
});
