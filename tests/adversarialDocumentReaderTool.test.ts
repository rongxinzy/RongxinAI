import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPiDocumentReaderTool } from '../src/main/libs/agentEngine/piDocumentReaderTool';

describe('Milestone 3 Adversarial Challenge: Document Reader Tool', () => {
  const roots: string[] = [];

  const createRoot = (): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-doc-reader-adversarial-'));
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
    for (const root of roots.splice(0)) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {}
    }
  });

  it('Scenario 3.1: AbortSignal pre-aborted cancellation returns DOCUMENT_ABORTED with isError: true', async () => {
    const root = createRoot();
    const tool = buildPiDocumentReaderTool({ workspaceRoot: root });

    const controller = new AbortController();
    controller.abort();

    const res = await tool.execute('call-1', { path: 'any.docx' }, controller.signal);
    expect(res.isError).toBe(true);
    expect(res.details.errorCode).toBe('DOCUMENT_ABORTED');
    expect(res.structuredContent.errorCode).toBe('DOCUMENT_ABORTED');
    expect(res.content[0].text).toContain('cancelled');
  });

  it('Scenario 3.2: Path traversal attempts return DOCUMENT_PATH_DENIED with isError: true', async () => {
    const root = createRoot();
    const tool = buildPiDocumentReaderTool({ workspaceRoot: root });

    const res = await tool.execute('call-1', { path: '../../etc/passwd' });
    expect(res.isError).toBe(true);
    expect(res.details.errorCode).toBe('DOCUMENT_PATH_DENIED');
    expect(res.structuredContent.errorCode).toBe('DOCUMENT_PATH_DENIED');
  });

  it('Scenario 3.3: Directory instead of file returns error code with isError: true', async () => {
    const root = createRoot();
    fs.mkdirSync(path.join(root, 'subfolder'));
    const tool = buildPiDocumentReaderTool({ workspaceRoot: root });

    const res = await tool.execute('call-1', { path: 'subfolder' });
    expect(res.isError).toBe(true);
    // Because resolveWorkspaceFile requires stat.isFile(), passing a directory returns null,
    // resulting in DOCUMENT_PATH_DENIED rather than DOCUMENT_NOT_A_FILE.
    expect(res.details.errorCode).toBe('DOCUMENT_PATH_DENIED');
    expect(res.structuredContent.errorCode).toBe('DOCUMENT_PATH_DENIED');
  });

  it('Scenario 3.4: Oversized document (>50MB) returns DOCUMENT_TOO_LARGE with isError: true', async () => {
    const root = createRoot();
    const largeFile = path.join(root, 'large.bin');
    // Create sparse / large file
    const fd = fs.openSync(largeFile, 'w');
    fs.writeSync(fd, Buffer.alloc(1), 0, 1, 51 * 1024 * 1024);
    fs.closeSync(fd);

    const tool = buildPiDocumentReaderTool({ workspaceRoot: root });
    const res = await tool.execute('call-1', { path: 'large.bin' });
    expect(res.isError).toBe(true);
    expect(res.details.errorCode).toBe('DOCUMENT_TOO_LARGE');
    expect(res.structuredContent.errorCode).toBe('DOCUMENT_TOO_LARGE');
    expect(res.details.bytes).toBeGreaterThan(50 * 1024 * 1024);
  });

  it('Scenario 3.5: Corrupted document returns DOCUMENT_CONVERSION_FAILED with isError: true', async () => {
    const root = createRoot();
    fs.writeFileSync(path.join(root, 'corrupt.docx'), 'not a real docx zip');

    const tool = buildPiDocumentReaderTool({ workspaceRoot: root });
    const res = await tool.execute('call-1', { path: 'corrupt.docx' });
    expect(res.isError).toBe(true);
    expect(res.details.errorCode).toBe('DOCUMENT_CONVERSION_FAILED');
    expect(res.structuredContent.errorCode).toBe('DOCUMENT_CONVERSION_FAILED');
    expect(res.content[0].text).toContain('Unable to read');
  });

  it('Scenario 3.6: Successful extraction includes text in details and structuredContent and leaves isError undefined', async () => {
    const root = createRoot();
    await writeDocxFixture(path.join(root, 'doc.docx'), 'Hello ZhiYuan');

    const tool = buildPiDocumentReaderTool({ workspaceRoot: root });
    const res = await tool.execute('call-1', { path: 'doc.docx' });

    expect(res.isError).toBeUndefined();
    expect(res.details.text).toContain('Hello ZhiYuan');
    expect(res.structuredContent.text).toContain('Hello ZhiYuan');
    expect(res.content[0].text).toContain('Hello ZhiYuan');
  });

  it('Scenario 3.7: Tool annotations conform to Pi standard', () => {
    const tool = buildPiDocumentReaderTool({ workspaceRoot: createRoot() });
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
      idempotentHint: true,
    });
  });
});
