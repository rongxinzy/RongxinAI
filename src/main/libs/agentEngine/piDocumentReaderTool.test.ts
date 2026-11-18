import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import JSZip from 'jszip';
import { afterEach, expect, test, vi } from 'vitest';

import { documentReaderWorkerMock } from '../../../../tests/fixtures/document-reader/worker.testHarness';

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

const pdf = vi.hoisted(() => ({ readPdfText: vi.fn(), ocrPdf: vi.fn() }));
vi.mock('../../ocr/pdfOcr', () => pdf);

const projectRoot = path.resolve(import.meta.dirname, '../../../..');
vi.mock('../../documentReader/officeDocument', importOriginal =>
  documentReaderWorkerMock(importOriginal),
);

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
  vi.resetAllMocks();
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

  expect(result.content[0]?.text).toContain('Walking on imported air');
});

test.each([
  ['legacy.doc', 'Fixture Document'],
  ['legacy.xls', '15.5%'],
])('reads real binary Office fixture %s in the WASM worker', async (filename, expected) => {
  const root = createRoot();
  fs.copyFileSync(
    path.join(projectRoot, 'tests/fixtures/document-reader', filename),
    path.join(root, filename),
  );
  const tool = buildPiDocumentReaderTool({ workspaceRoot: root });
  const result = await tool.execute('legacy', { path: filename });
  expect(result.isError).toBeUndefined();
  expect(result.structuredContent.text).toContain(expected);
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

test('keeps Chinese PDF text and sends only the scan page to OCR', async () => {
  ocrState.supported = true;
  pdf.readPdfText.mockResolvedValue({
    pages: [
      { page: 1, text: '季度预算分析报告' },
      { page: 2, text: '' },
    ],
    pageCount: 2,
    truncated: false,
  });
  pdf.ocrPdf.mockResolvedValue({
    pages: [{ page: 2, text: '扫描件正文' }],
    pageCount: 2,
    truncated: false,
  });
  const root = createRoot();
  fs.writeFileSync(path.join(root, 'scan.pdf'), '%PDF-1.4');
  const tool = buildPiDocumentReaderTool({ workspaceRoot: root });
  const result = await tool.execute('tool-1', {
    path: 'scan.pdf',
    pages: '1-2',
    language: 'zh-CN',
  });
  expect(pdf.readPdfText).toHaveBeenCalledWith(
    expect.stringContaining('scan.pdf'),
    '1-2',
    expect.any(AbortSignal),
  );
  expect(pdf.ocrPdf).toHaveBeenCalledWith(
    expect.stringContaining('scan.pdf'),
    [2],
    'zh-CN',
    expect.any(AbortSignal),
  );
  expect(result.structuredContent.text).toBe(
    '## Page 1\n季度预算分析报告\n\n## Page 2\n扫描件正文',
  );
  expect(result.details).toMatchObject({ source: 'pdf-text+ocr', pages: 2, pageCount: 2 });
});

test('accepts a short Chinese text layer without OCR even with a PDF page range', async () => {
  ocrState.supported = true;
  pdf.readPdfText.mockResolvedValue({
    pages: [{ page: 2, text: '发票' }],
    pageCount: 2,
    truncated: false,
  });
  const root = createRoot();
  fs.writeFileSync(path.join(root, 'text.pdf'), '%PDF-1.4');
  const result = await buildPiDocumentReaderTool({ workspaceRoot: root }).execute('tool-1', {
    path: 'text.pdf',
    pages: '2',
  });
  expect(result.structuredContent.text).toBe('## Page 2\n发票');
  expect(result.details).toMatchObject({ source: 'pdf-text', pages: 1, pageCount: 2 });
  expect(pdf.ocrPdf).not.toHaveBeenCalled();
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

test('declares native tool annotations and output schema with text property', () => {
  const tool = buildPiDocumentReaderTool({ workspaceRoot: createRoot() });
  expect(tool.annotations).toEqual({
    readOnlyHint: true,
    openWorldHint: false,
    idempotentHint: true,
  });
  expect(tool.outputSchema).toMatchObject({ properties: { text: expect.anything() } });
});

test('populates structuredContent.text on successful document reading', async () => {
  const root = createRoot();
  await writeDocxFixture(path.join(root, 'structured.docx'), 'Structured codemode text');
  const tool = buildPiDocumentReaderTool({ workspaceRoot: root });

  const result = await tool.execute('tool-1', { path: 'structured.docx' });
  expect(result.structuredContent.text).toContain('Structured codemode text');
  expect(result.details.text).toContain('Structured codemode text');
  expect(result.isError).toBeUndefined();
});

test('sets isError: true on path denial', async () => {
  const root = createRoot();
  const tool = buildPiDocumentReaderTool({ workspaceRoot: root });

  const denied = await tool.execute('tool-1', { path: '../forbidden.docx' });
  expect(denied.isError).toBe(true);
  expect(denied.details.errorCode).toBe('DOCUMENT_PATH_DENIED');

  const missing = await tool.execute('tool-2', { path: 'nonexistent.docx' });
  expect(missing.isError).toBe(true);
  expect(missing.details.errorCode).toBe('DOCUMENT_PATH_DENIED');
});

test('aborts early when AbortSignal is triggered', async () => {
  const root = createRoot();
  await writeDocxFixture(path.join(root, 'abort.docx'), 'Will not be read');
  const tool = buildPiDocumentReaderTool({ workspaceRoot: root });

  const controller = new AbortController();
  controller.abort();

  const result = await tool.execute('tool-1', { path: 'abort.docx' }, controller.signal);
  expect(result.isError).toBe(true);
  expect(result.details.errorCode).toBe('DOCUMENT_ABORTED');
  expect(result.content[0]?.text).toContain('cancelled');
});
