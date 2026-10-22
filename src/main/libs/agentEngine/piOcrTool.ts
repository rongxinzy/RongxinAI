/**
 * `ocr` tool: local, offline text extraction from images and scanned PDFs.
 *
 * Without a multimodal model the harness withholds images from the prompt, so
 * this tool is the only way to turn a screenshot or a scanned contract into text.
 * It deliberately returns text only: no layout, no colors, no chart semantics.
 */

import * as fs from 'fs';
import path from 'path';

import { resolveWorkspaceFile } from '../../workbenchTask/artifactCollector';
import { getOcrStatus, isOcrSupported, readOcrText } from '../../ocr/ocrEngine';
import { ocrPdf } from '../../ocr/pdfOcr';

const PiOcrToolName = 'ocr';
export const PiOcrSystemPrompt = [
  '## Local OCR',
  '',
  '- Use `ocr` for images (screenshots, photos, scans) and for PDFs whose pages are scanned images rather than text.',
  '- It runs a local Windows OCR engine: offline, no model call, text only. It cannot describe layout, colors, charts, or fonts — say so instead of guessing.',
  '- `read_document` already falls back to OCR for PDFs without a text layer, so prefer it for documents and use `ocr` for images or for a specific page range.',
].join('\n');

const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;
const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.gif',
]);

type OcrToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** resolveWorkspaceFile folds "missing" into null; keep the two errors distinct. */
function isInsideWorkspace(workspaceRoot: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(candidate));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

const truncate = (value: string): { text: string; truncated: boolean } =>
  value.length > MAX_TEXT_CHARS
    ? { text: value.slice(0, MAX_TEXT_CHARS), truncated: true }
    : { text: value, truncated: false };

export function buildPiOcrTool(options: { workspaceRoot: string }): Record<string, unknown> {
  return {
    name: PiOcrToolName,
    label: 'OCR',
    description:
      'Extract text from an image or a scanned PDF with the local Windows OCR engine. ' +
      'Offline and text-only: it does not describe layout, colors or charts.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Image or PDF path relative to the current workspace.',
        },
        pages: {
          type: 'string',
          description: 'For PDFs only: page range such as "1-5" or "3". Defaults to all pages.',
        },
        language: {
          type: 'string',
          description: 'BCP-47 OCR language tag. Defaults to the Windows profile language.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async (
      _toolCallId: string,
      params: Record<string, unknown>,
    ): Promise<OcrToolResult> => {
      if (!isOcrSupported()) {
        return {
          content: [
            {
              type: 'text',
              text: 'Local OCR is available on Windows only. Ask the user to paste the text instead.',
            },
          ],
          details: { errorCode: 'OCR_UNSUPPORTED_PLATFORM' },
        };
      }

      const requestedPath = text(params.path);
      const filePath = resolveWorkspaceFile(options.workspaceRoot, requestedPath);
      if (!filePath) {
        const candidate = path.isAbsolute(requestedPath)
          ? path.normalize(requestedPath)
          : path.resolve(options.workspaceRoot, requestedPath);
        if (isInsideWorkspace(options.workspaceRoot, candidate) && !fs.existsSync(candidate)) {
          return {
            content: [{ type: 'text', text: `File not found: ${requestedPath}` }],
            details: { errorCode: 'OCR_FILE_NOT_FOUND', path: requestedPath },
          };
        }
        return {
          content: [
            { type: 'text', text: 'OCR denied: path must be a file inside the workspace.' },
          ],
          details: { errorCode: 'OCR_PATH_DENIED', path: requestedPath },
        };
      }

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        return {
          content: [{ type: 'text', text: `File not found: ${requestedPath}` }],
          details: { errorCode: 'OCR_FILE_NOT_FOUND', path: requestedPath },
        };
      }
      if (!stat.isFile()) {
        return {
          content: [{ type: 'text', text: `OCR denied: ${requestedPath} is not a file.` }],
          details: { errorCode: 'OCR_NOT_A_FILE', path: requestedPath },
        };
      }

      const extension = path.extname(filePath).toLowerCase();
      const language = text(params.language) || undefined;
      const status = await getOcrStatus(language);
      if (!status.ready) {
        return {
          content: [
            {
              type: 'text',
              text: `Local OCR engine is unavailable (${status.languages.length > 0 ? `installed languages: ${status.languages.join(', ')}` : 'no OCR language pack'}). Ask the user to paste the text.`,
            },
          ],
          details: { errorCode: 'OCR_ENGINE_UNAVAILABLE', languages: status.languages },
        };
      }

      if (extension === '.pdf') {
        const result = await ocrPdf(filePath, {
          pages: text(params.pages) || undefined,
          language,
        });
        const body = result.pages
          .map(page => `## Page ${page.page}\n${page.text.trim() || '(no text recognized)'}`)
          .join('\n\n');
        const { text: output, truncated } = truncate(body);
        const header = [
          `File: ${requestedPath}`,
          `Source: local OCR (${status.engine ?? 'windows-media-ocr'})`,
          `Pages: ${result.renderedCount}/${result.pageCount}${result.truncated ? ' (limit reached)' : ''}`,
          '',
        ].join('\n');
        return {
          content: [{ type: 'text', text: `${header}\n${output || '(no machine-readable text)'}` }],
          details: {
            path: requestedPath,
            pages: result.renderedCount,
            pageCount: result.pageCount,
            truncated,
            engine: status.engine,
            empty: body.trim().length === 0,
          },
        };
      }

      if (!IMAGE_EXTENSIONS.has(extension)) {
        return {
          content: [
            {
              type: 'text',
              text: `OCR supports images and PDFs; ${extension || 'this file'} is not supported.`,
            },
          ],
          details: { errorCode: 'OCR_UNSUPPORTED_FORMAT', path: requestedPath },
        };
      }
      if (stat.size > MAX_IMAGE_BYTES) {
        return {
          content: [{ type: 'text', text: `OCR denied: ${requestedPath} is larger than 40 MiB.` }],
          details: { errorCode: 'OCR_FILE_TOO_LARGE', path: requestedPath, bytes: stat.size },
        };
      }

      const result = await readOcrText([filePath], language);
      const { text: output, truncated } = truncate(result.text);
      const header = [
        `File: ${requestedPath}`,
        `Source: local OCR (${status.engine ?? 'windows-media-ocr'})`,
        `Language: ${language ?? status.requested}`,
        '',
      ].join('\n');
      return {
        content: [
          {
            type: 'text',
            text: `${header}\n${output || '(no machine-readable text recognized — the image may be a photo, icon, or chart)'}`,
          },
        ],
        details: {
          path: requestedPath,
          truncated,
          engine: status.engine,
          empty: result.empty,
          lineCount: result.images.reduce((total, image) => total + image.lines.length, 0),
        },
      };
    },
  };
}
