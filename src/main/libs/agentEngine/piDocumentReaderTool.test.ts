import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import JSZip from 'jszip';
import { afterEach, expect, test } from 'vitest';

import { buildPiDocumentReaderTool, PiDocumentReaderSystemPrompt } from './piDocumentReaderTool';

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

test('publishes the harness document-reading policy', () => {
  expect(PiDocumentReaderSystemPrompt).toContain('read_document');
  expect(PiDocumentReaderSystemPrompt).toContain('scanned or image-only PDFs');
});
