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

describe('Adversarial Stress Harness: Payload Truncation Bounds', () => {
  // 2. Truncation Stress Harness on Large Payloads (100KB, 500KB, 2MB)
  // ─────────────────────────────────────────────────────────────────────────────

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
  });
});
