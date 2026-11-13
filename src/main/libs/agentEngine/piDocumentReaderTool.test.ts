import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import JSZip from 'jszip';
import { afterEach, expect, test, vi } from 'vitest';

const ocrState = vi.hoisted(() => ({
  supported: false,
  ready: true,
}));

vi.mock('../../ocr/ocrEngine', () => ({
  isOcrSupported: () => ocrState.supported,
  getOcrStatus: async () => ({
    ready: ocrState.ready,
    engine: 'windows-media-ocr',
    languages: ['zh-Hans-CN'],
    requested: 'zh-Hans-CN',
  }),
  readOcrText: async () => ({
    text: '季度经营分析报告',
    images: [{ path: 'shot.png', lines: [{ text: '季度经营分析报告' }] }],
    empty: false,
  }),
}));

vi.mock('../../ocr/pdfOcr', () => ({
  ocrPdf: async () => ({
    pages: [{ page: 1, text: '第一页正文', lines: [] }],
    pageCount: 1,
    renderedCount: 1,
    truncated: false,
  }),
}));

import { buildPiDocumentReaderTool } from './piDocumentReaderTool';

const roots: string[] = [];

const createRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-document-reader-'));
  roots.push(root);
  return root;
};

const writeDocxFixture = async (filePath: string, paragraph: string): Promise<void> => {
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
  <w:body><w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p></w:body>
</w:document>`,
  );
  fs.writeFileSync(filePath, await archive.generateAsync({ type: 'nodebuffer' }));
};

afterEach(() => {
  ocrState.supported = false;
  ocrState.ready = true;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('converts a workspace DOCX fixture to Markdown locally', async () => {
  const root = createRoot();
  await writeDocxFixture(path.join(root, 'example.docx'), 'Walking on imported air');
  const tool = buildPiDocumentReaderTool({ workspaceRoot: root }) as {
    execute: (
      id: string,
      params: { path: string },
    ) => Promise<{ content: Array<{ text: string }> }>;
  };

  const result = await tool.execute('tool-1', { path: 'example.docx' });

  expect(result.content[0]?.text).toContain('Local conversion: AnyDoc\n\nWalking on imported air');
});

test('does not allow symlinks or junctions that leave the workspace', async () => {
  const root = createRoot();
  const outside = createRoot();
  await writeDocxFixture(path.join(outside, 'outside.docx'), 'Outside the workspace');
  fs.symlinkSync(
    outside,
    path.join(root, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const tool = buildPiDocumentReaderTool({ workspaceRoot: root }) as {
    execute: (
      id: string,
      params: { path: string },
    ) => Promise<{ content: Array<{ text: string }> }>;
  };

  const result = await tool.execute('tool-1', { path: 'linked/outside.docx' });

  expect(result.content[0]?.text).toContain('path must be a file inside the workspace');
});

test('does not allow paths outside the workspace', async () => {
  const tool = buildPiDocumentReaderTool({ workspaceRoot: createRoot() }) as {
    execute: (
      id: string,
      params: { path: string },
    ) => Promise<{ content: Array<{ text: string }> }>;
  };

  const result = await tool.execute('tool-1', { path: '../secret.docx' });

  expect(result.content[0]?.text).toContain('path must be a file inside the workspace');
});

test('publishes routing and OCR boundaries directly via promptGuidelines', () => {
  const tool = buildPiDocumentReaderTool({ workspaceRoot: createRoot() }) as {
    description: string;
    promptGuidelines: string[];
  };
  expect(tool.description).toContain('local OCR');
  expect(tool.promptGuidelines.join('\n')).toContain('read_document');
  expect(tool.promptGuidelines.join('\n')).toContain('Local OCR');
});

test('reads an image through local OCR when supported and reports Windows-only otherwise', async () => {
  const root = createRoot();
  fs.writeFileSync(path.join(root, 'shot.png'), 'png');
  const tool = buildPiDocumentReaderTool({ workspaceRoot: root }) as {
    execute: (
      id: string,
      params: { path: string },
    ) => Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }>;
  };

  const unsupported = await tool.execute('tool-1', { path: 'shot.png' });
  expect(unsupported.details.errorCode).toBe('OCR_UNSUPPORTED_PLATFORM');
  expect(unsupported.content[0]?.text).toContain('Windows only');

  ocrState.supported = true;
  const recognized = await tool.execute('tool-2', { path: 'shot.png' });
  expect(recognized.content[0]?.text).toContain('季度经营分析报告');
  expect(recognized.details.source).toBe('ocr');
  expect(recognized.details.engine).toBe('windows-media-ocr');
});

test('pages a scanned PDF through local OCR when pages is supplied', async () => {
  ocrState.supported = true;
  const root = createRoot();
  fs.writeFileSync(path.join(root, 'scan.pdf'), '%PDF-1.4');
  const tool = buildPiDocumentReaderTool({ workspaceRoot: root }) as {
    execute: (
      id: string,
      params: { path: string; pages?: string },
    ) => Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }>;
  };

  const result = await tool.execute('tool-1', { path: 'scan.pdf', pages: '1' });
  expect(result.content[0]?.text).toContain('第一页正文');
  expect(result.details.source).toBe('ocr');
  expect(result.details.pages).toBe(1);
});

test('truncates documents exceeding PI_DOCUMENT_READER_MAX_CHARS', async () => {
  const root = createRoot();
  const oversizedText = 'A'.repeat(90_000);
  await writeDocxFixture(path.join(root, 'large.docx'), oversizedText);
  const tool = buildPiDocumentReaderTool({ workspaceRoot: root }) as {
    execute: (
      id: string,
      params: { path: string },
    ) => Promise<{
      content: Array<{ text: string }>;
      details: { truncated: boolean; markdownCharacters: number };
    }>;
  };

  const result = await tool.execute('tool-1', { path: 'large.docx' });

  expect(result.details.truncated).toBe(true);
  expect(result.details.markdownCharacters).toBeGreaterThanOrEqual(90_000);
  expect(result.content[0]?.text).toContain('Output truncated to 30,000 characters');
  expect(result.content[0]?.text).toContain(
    `read ${result.details.markdownCharacters.toLocaleString()} characters`,
  );
});

test('safely truncates documents with astral plane surrogates at boundary', async () => {
  const root = createRoot();
  const boundaryText = 'B'.repeat(29_999) + '🚀tail';
  await writeDocxFixture(path.join(root, 'boundary.docx'), boundaryText);
  const tool = buildPiDocumentReaderTool({ workspaceRoot: root }) as {
    execute: (
      id: string,
      params: { path: string },
    ) => Promise<{
      content: Array<{ text: string }>;
      details: { truncated: boolean };
    }>;
  };

  const result = await tool.execute('tool-1', { path: 'boundary.docx' });
  expect(result.details.truncated).toBe(true);
  expect(result.content[0]?.text).toContain('Output truncated to 30,000 characters');
});
