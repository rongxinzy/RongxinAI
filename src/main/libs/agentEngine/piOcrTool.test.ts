import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ocr-tool-'));
const ocrAvailable = { value: true };

vi.mock('../../ocr/ocrEngine', () => ({
  isOcrSupported: () => ocrAvailable.value,
  getOcrStatus: async () => ({
    ready: true,
    engine: 'windows-media-ocr',
    languages: ['zh-Hans-CN'],
    requested: 'zh-Hans-CN',
  }),
  readOcrText: async () => ({
    text: '季度经营分析报告',
    images: [{ path: 'x', lines: [{ text: '季度经营分析报告' }] }],
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

import { buildPiOcrTool } from './piOcrTool';

type ToolResult = {
  content: Array<{ text: string }>;
  details: Record<string, unknown>;
};

const tool = buildPiOcrTool({ workspaceRoot }) as {
  execute: (id: string, params: Record<string, unknown>) => Promise<ToolResult>;
};

afterEach(() => {
  ocrAvailable.value = true;
});

describe('ocr tool', () => {
  test('reports the platform limitation instead of failing', async () => {
    ocrAvailable.value = false;
    const result = await tool.execute('t1', { path: 'shot.png' });
    expect(result.content[0]?.text).toContain('Windows only');
    expect(result.details.errorCode).toBe('OCR_UNSUPPORTED_PLATFORM');
  });

  test('rejects paths outside the workspace', async () => {
    const result = await tool.execute('t2', { path: '../secret.png' });
    expect(result.content[0]?.text).toContain('inside the workspace');
    expect(result.details.errorCode).toBe('OCR_PATH_DENIED');
  });

  test('reports a missing file', async () => {
    const result = await tool.execute('t3', { path: 'missing.png' });
    expect(result.content[0]?.text).toContain('File not found');
    expect(result.details.errorCode).toBe('OCR_FILE_NOT_FOUND');
  });

  test('rejects unsupported extensions', async () => {
    fs.writeFileSync(path.join(workspaceRoot, 'notes.txt'), 'plain text');
    const result = await tool.execute('t4', { path: 'notes.txt' });
    expect(result.details.errorCode).toBe('OCR_UNSUPPORTED_FORMAT');
  });

  test('returns recognized text for an image', async () => {
    fs.writeFileSync(path.join(workspaceRoot, 'shot.png'), 'png');
    const result = await tool.execute('t5', { path: 'shot.png' });
    expect(result.content[0]?.text).toContain('季度经营分析报告');
    expect(result.details.engine).toBe('windows-media-ocr');
  });

  test('pages a PDF through the OCR pipeline', async () => {
    fs.writeFileSync(path.join(workspaceRoot, 'scan.pdf'), '%PDF-1.4');
    const result = await tool.execute('t6', { path: 'scan.pdf', pages: '1' });
    expect(result.content[0]?.text).toContain('第一页正文');
    expect(result.details.pages).toBe(1);
  });
});
