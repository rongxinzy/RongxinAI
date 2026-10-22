/**
 * Scanned-PDF OCR: rasterize pages with the packaged Skill Python layer
 * (pypdfium2 + Pillow already ship for the PDF Skill) and run each rendered page
 * through the Windows OCR engine.
 *
 * Rasterization is a child process on purpose: decoding and rendering pages is
 * CPU heavy and must never run on the main thread.
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { findSharedSkillPythonExecutable } from '../libs/skillPythonRuntime';
import { recognizeImages, type OcrImageText } from './ocrEngine';

interface OcrPdfPage {
  page: number;
  text: string;
  lines: OcrImageText['lines'];
}

export interface OcrPdfResult {
  pages: OcrPdfPage[];
  pageCount: number;
  renderedCount: number;
  truncated: boolean;
}

export interface OcrPdfOptions {
  pages?: string;
  dpi?: number;
  maxPages?: number;
  language?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

const PDF_PAGES_SCRIPT_SEGMENTS = ['ocr', 'pdf-pages.py'];

function resolvePdfPagesScript(): string | null {
  const candidates: string[] = [];
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, ...PDF_PAGES_SCRIPT_SEGMENTS));
  }
  candidates.push(
    path.join(__dirname, '..', '..', '..', 'resources', ...PDF_PAGES_SCRIPT_SEGMENTS),
  );
  candidates.push(path.join(process.cwd(), 'resources', ...PDF_PAGES_SCRIPT_SEGMENTS));
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}

interface RenderScriptOutput {
  pageCount?: number;
  renderedCount?: number;
  truncated?: boolean;
  pages?: Array<{ page?: number; path?: string }>;
}

function runPython(
  python: string,
  script: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(python, [script, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const timer = setTimeout(() => {
      child.kill();
      finish(-2);
    }, timeoutMs);
    child.on('error', error => {
      stderr += error.message;
      finish(-3);
    });
    child.on('close', code => finish(code ?? -4));
  });
}

/** Rasterize and OCR a PDF. Throws when the Python layer or OCR engine is missing. */
export async function ocrPdf(filePath: string, options: OcrPdfOptions = {}): Promise<OcrPdfResult> {
  const python = findSharedSkillPythonExecutable();
  const script = resolvePdfPagesScript();
  if (!python || !script) {
    throw new Error(
      'Scanned-PDF OCR needs the packaged PDF runtime (pypdfium2/Pillow) and the OCR helper.',
    );
  }

  const workDir = path.join(os.tmpdir(), `zhiyuan-ocr-pdf-${randomUUID()}`);
  fs.mkdirSync(workDir, { recursive: true });
  try {
    const args = [
      '--input',
      filePath,
      '--pages',
      options.pages ?? 'all',
      '--dpi',
      String(options.dpi ?? 200),
      '--out',
      workDir,
      '--max-pages',
      String(options.maxPages ?? 20),
      '--json',
    ];
    const rendered = await runPython(python, script, args, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (rendered.code !== 0) {
      throw new Error(rendered.stderr.trim() || `pdf-pages.py exited with ${rendered.code}`);
    }
    const parsed = JSON.parse(
      rendered.stdout.slice(rendered.stdout.indexOf('{')),
    ) as RenderScriptOutput;
    const pages = parsed.pages ?? [];
    if (pages.length === 0) {
      return { pages: [], pageCount: parsed.pageCount ?? 0, renderedCount: 0, truncated: false };
    }

    const recognized = await recognizeImages(
      pages.map(page => page.path as string),
      options.language,
    );
    const byPath = new Map(recognized.map(image => [image.path, image]));
    const results: OcrPdfPage[] = pages.map((page, index) => {
      const image = byPath.get(page.path as string) ?? recognized[index];
      return {
        page: page.page ?? index + 1,
        text: (image?.lines ?? []).map(line => line.text).join('\n'),
        lines: image?.lines ?? [],
      };
    });
    return {
      pages: results,
      pageCount: parsed.pageCount ?? results.length,
      renderedCount: results.length,
      truncated: parsed.truncated === true,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
