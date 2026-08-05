import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import { afterEach, expect, test } from 'vitest';

import { buildPiDocumentReaderTool, PiDocumentReaderSystemPrompt } from './piDocumentReaderTool';

const roots: string[] = [];

const createRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-document-reader-'));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('converts a workspace DOCX fixture to Markdown locally', async () => {
  const root = createRoot();
  const fixture = path.resolve(
    process.cwd(),
    'vendor/openclaw-plugins/dingtalk-connector/node_modules/mammoth/test/test-data/single-paragraph.docx',
  );
  fs.copyFileSync(fixture, path.join(root, 'example.docx'));
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
  const fixture = path.resolve(
    process.cwd(),
    'vendor/openclaw-plugins/dingtalk-connector/node_modules/mammoth/test/test-data/single-paragraph.docx',
  );
  fs.copyFileSync(fixture, path.join(outside, 'outside.docx'));
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
