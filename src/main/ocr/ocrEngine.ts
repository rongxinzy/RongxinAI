/**
 * Windows OCR engine (Windows.Media.Ocr) behind a narrow async interface.
 *
 * The recognition itself happens in the bundled PowerShell helper: WinRT
 * projection from Node is not available, and a child process also keeps the
 * main thread free. This module owns batching, JSON parsing, timeouts and the
 * small amount of text cleanup the engine cannot do (it inserts spaces between
 * CJK characters).
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { resolveBundledOcrScriptPath } from '../libs/ocrHelper';

interface OcrLine {
  text: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface OcrImageText {
  path: string;
  width?: number;
  height?: number;
  lines: OcrLine[];
  error?: string;
}

export interface OcrEngineStatus {
  ready: boolean;
  engine: string | null;
  languages: string[];
  requested: string;
}

export interface OcrTextResult {
  text: string;
  images: OcrImageText[];
  /** True when the engine reported no machine-readable text anywhere. */
  empty: boolean;
}

const DEFAULT_LANGUAGE = 'zh-Hans-CN';
const MAX_IMAGES_PER_CALL = 12;
const STATUS_TTL_MS = 10 * 60 * 1000;
const CALL_TIMEOUT_MS = 5 * 60 * 1000;

let cachedStatus: { value: OcrEngineStatus; at: number } | null = null;

export function isOcrSupported(): boolean {
  return resolveBundledOcrScriptPath() !== null;
}

function runPowerShell(
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const scriptPath = resolveBundledOcrScriptPath();
  if (!scriptPath) {
    return Promise.resolve({
      code: -1,
      stdout: '',
      stderr: 'OCR helper is not bundled on this platform.',
    });
  }
  return new Promise(resolve => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
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

/**
 * Chinese/Japanese/Korean text comes back with a space between every character;
 * collapsing those pairs restores readable words without touching Latin text.
 */
export function normalizeOcrText(value: string): string {
  return value
    .replace(
      /([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])\s+(?=[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])/g,
      '$1',
    )
    .replace(/\s+([，。；：、？！）】」』])/g, '$1')
    .replace(/^\s+|\s+$/g, '');
}

interface RawOcrResponse {
  results?: Array<{
    path?: string;
    width?: number;
    height?: number;
    lines?: Array<{ text?: string; x?: number; y?: number; w?: number; h?: number }>;
    error?: string;
  }>;
  error?: string;
}

function parseJson(stdout: string): RawOcrResponse | null {
  const start = stdout.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(stdout.slice(start)) as RawOcrResponse;
  } catch {
    return null;
  }
}

export async function getOcrStatus(language: string = DEFAULT_LANGUAGE): Promise<OcrEngineStatus> {
  if (cachedStatus && Date.now() - cachedStatus.at < STATUS_TTL_MS) return cachedStatus.value;

  const unavailable: OcrEngineStatus = {
    ready: false,
    engine: null,
    languages: [],
    requested: language,
  };
  if (!isOcrSupported()) {
    cachedStatus = { value: unavailable, at: Date.now() };
    return unavailable;
  }

  const { code, stdout } = await runPowerShell(['-Status', '-Json', '-Lang', language], 60_000);
  const parsed = code === 0 ? (parseJson(stdout) as Partial<OcrEngineStatus> | null) : null;
  const value: OcrEngineStatus = {
    ready: parsed?.ready === true,
    engine: typeof parsed?.engine === 'string' ? parsed.engine : null,
    languages: Array.isArray(parsed?.languages) ? parsed.languages.filter(Boolean) : [],
    requested: language,
  };
  cachedStatus = { value, at: Date.now() };
  return value;
}

export async function recognizeImages(
  imagePaths: string[],
  language: string = DEFAULT_LANGUAGE,
): Promise<OcrImageText[]> {
  if (imagePaths.length === 0 || !isOcrSupported()) return [];

  const results: OcrImageText[] = [];
  for (let offset = 0; offset < imagePaths.length; offset += MAX_IMAGES_PER_CALL) {
    const batch = imagePaths.slice(offset, offset + MAX_IMAGES_PER_CALL);
    const pathsFile = path.join(os.tmpdir(), `zhiyuan-ocr-${randomUUID()}.json`);
    try {
      fs.writeFileSync(pathsFile, JSON.stringify(batch), 'utf8');
      const { stdout } = await runPowerShell(
        ['-PathsFile', pathsFile, '-Json', '-Lang', language],
        CALL_TIMEOUT_MS,
      );
      const parsed = parseJson(stdout);
      for (const entry of parsed?.results ?? []) {
        results.push({
          path: entry.path ?? '',
          width: entry.width,
          height: entry.height,
          error: entry.error,
          lines: (entry.lines ?? [])
            .filter(line => typeof line.text === 'string' && line.text.trim().length > 0)
            .map(line => ({
              text: normalizeOcrText(line.text as string),
              x: line.x,
              y: line.y,
              w: line.w,
              h: line.h,
            })),
        });
      }
    } finally {
      fs.rmSync(pathsFile, { force: true });
    }
  }
  return results;
}

/** Recognize a set of images and join their lines into one text block. */
export async function readOcrText(
  imagePaths: string[],
  language: string = DEFAULT_LANGUAGE,
): Promise<OcrTextResult> {
  const images = await recognizeImages(imagePaths, language);
  const text = images
    .map(image => image.lines.map(line => line.text).join('\n'))
    .filter(Boolean)
    .join('\n\n');
  return { text, images, empty: text.trim().length === 0 };
}
