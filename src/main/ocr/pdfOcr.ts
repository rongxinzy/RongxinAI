import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { DOCUMENT_MAX_CHARACTERS } from '../documentReader/constants';
import { findSharedSkillPythonExecutable } from '../libs/skillPythonRuntime';
import { recognizeImages } from './ocrEngine';

interface PdfPage {
  page: number;
  text: string;
}

interface PdfPageResult<T> {
  pageCount: number;
  truncated: boolean;
  pages: T[];
}

const MAX_TEXT_PAGES = 200;
const MAX_OCR_PAGES = 20;
const PDF_PAGES_SCRIPT = path.join('ocr', 'pdf-pages.py');
const execFileAsync = promisify(execFile);

function resolvePdfPagesScript(): string | undefined {
  const roots = [
    process.resourcesPath,
    path.join(__dirname, '../resources'),
    path.resolve('resources'),
  ];
  return roots
    .filter(Boolean)
    .map(root => path.join(root, PDF_PAGES_SCRIPT))
    .find(fs.existsSync);
}

async function runPdfPages<T extends { page: number }>(
  filePath: string,
  pages: string,
  maxPages: number,
  args: string[],
  validatePage: (page: T) => boolean,
  signal: AbortSignal,
): Promise<PdfPageResult<T>> {
  signal.throwIfAborted();
  const python = findSharedSkillPythonExecutable();
  const script = resolvePdfPagesScript();
  if (!python || !script) throw new Error('The bundled PDF runtime is unavailable.');
  const { stdout } = await execFileAsync(
    python,
    [
      script,
      '--input',
      filePath,
      '--pages',
      pages,
      '--max-pages',
      String(maxPages),
      '--json',
      ...args,
    ],
    {
      signal,
      windowsHide: true,
      maxBuffer: 512 * 1024,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    },
  );
  const result = JSON.parse(stdout) as PdfPageResult<T>;
  if (
    !result ||
    !Number.isSafeInteger(result.pageCount) ||
    result.pageCount < 0 ||
    typeof result.truncated !== 'boolean' ||
    !Array.isArray(result.pages) ||
    result.pages.length > maxPages ||
    !result.pages.every(
      page =>
        page &&
        Number.isSafeInteger(page.page) &&
        page.page > 0 &&
        page.page <= result.pageCount &&
        validatePage(page),
    )
  ) {
    throw new Error('Invalid bundled PDF runtime response.');
  }
  return result;
}

export function readPdfText(filePath: string, pages: string | undefined, signal: AbortSignal) {
  return runPdfPages<PdfPage>(
    filePath,
    pages ?? 'all',
    MAX_TEXT_PAGES,
    ['--text', '--max-characters', String(DOCUMENT_MAX_CHARACTERS)],
    page => typeof page.text === 'string' && page.text.length <= DOCUMENT_MAX_CHARACTERS * 2,
    signal,
  );
}

/** Render only the pages identified as lacking usable text, then run Windows OCR. */
export async function ocrPdf(
  filePath: string,
  pages: number[],
  language: string | undefined,
  signal: AbortSignal,
): Promise<PdfPageResult<PdfPage>> {
  signal.throwIfAborted();
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-ocr-pdf-'));
  try {
    const rendered = await runPdfPages<{ page: number; path: string }>(
      filePath,
      pages.slice(0, MAX_OCR_PAGES).join(','),
      MAX_OCR_PAGES,
      ['--out', workDir],
      page => page.path === path.join(workDir, `page-${String(page.page).padStart(4, '0')}.png`),
      signal,
    );
    const recognized = await recognizeImages(
      rendered.pages.map(page => page.path),
      language,
      signal,
    );
    const byPath = new Map(recognized.map(image => [image.path, image]));
    return {
      pageCount: rendered.pageCount,
      truncated: rendered.truncated || pages.length > MAX_OCR_PAGES,
      pages: rendered.pages.map(page => ({
        page: page.page,
        text: (byPath.get(page.path)?.lines ?? []).map(line => line.text).join('\n'),
      })),
    };
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  }
}
