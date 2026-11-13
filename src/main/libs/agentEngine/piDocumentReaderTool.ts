import * as fs from 'fs';
import path from 'path';

import { formatFromPath, toMarkdown } from '@firecrawl/anydoc';

import { safeSlice } from '../../../shared/lib/safeSlice';
import { resolveWorkspaceFile } from './workspaceFile';
import { getOcrStatus, isOcrSupported, readOcrText } from '../../ocr/ocrEngine';
import { ocrPdf } from '../../ocr/pdfOcr';

export const PiDocumentReaderToolName = 'read_document';

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
// Lowered to 30,000 characters to match other tools and protect 64k models in CJK workflows
export const PI_DOCUMENT_READER_MAX_CHARS = 30_000;
const MAX_MARKDOWN_CHARS = PI_DOCUMENT_READER_MAX_CHARS;
/** Below this many non-whitespace characters a PDF is treated as image-only. */
const SCANNED_PDF_TEXT_THRESHOLD = 80;
const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.bmp',
  '.tif',
  '.tiff',
  '.gif',
  '.webp',
]);

type DocumentReaderToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function buildOcrFailure(
  errorCode: string,
  message: string,
  requestedPath: string,
): DocumentReaderToolResult {
  return {
    content: [{ type: 'text', text: message }],
    details: { errorCode, path: requestedPath },
  };
}

async function readImageWithOcr(
  filePath: string,
  requestedPath: string,
  language: string | undefined,
  bytes: number,
): Promise<DocumentReaderToolResult> {
  if (!isOcrSupported()) {
    return buildOcrFailure(
      'OCR_UNSUPPORTED_PLATFORM',
      'Local OCR is currently Windows only; on this platform inspect the image directly when vision input is available.',
      requestedPath,
    );
  }
  const status = await getOcrStatus(language);
  if (!status.ready) {
    return buildOcrFailure(
      'OCR_ENGINE_UNAVAILABLE',
      'Local Windows OCR language pack is unavailable for this image.',
      requestedPath,
    );
  }
  const result = await readOcrText([filePath], language);
  const truncated = result.text.length > MAX_MARKDOWN_CHARS;
  const output = truncated ? safeSlice(result.text, MAX_MARKDOWN_CHARS) : result.text;
  const header = [
    `File: ${requestedPath}`,
    `Source: local OCR (${status.engine ?? 'windows-media-ocr'})`,
    `Language: ${language ?? status.requested}`,
    truncated
      ? `Output truncated to ${MAX_MARKDOWN_CHARS.toLocaleString()} characters (read ${result.text.length.toLocaleString()} characters).`
      : '',
    '',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    content: [
      {
        type: 'text',
        text: `${header}\n${output || '(no machine-readable text recognized — the image may be a photo, icon, or chart)'}`,
      },
    ],
    details: {
      path: requestedPath,
      bytes,
      source: 'ocr',
      truncated,
      engine: status.engine,
      empty: result.empty,
      lineCount: result.images.reduce((total, image) => total + image.lines.length, 0),
    },
  };
}

async function readScannedPdfWithOcr(
  filePath: string,
  requestedPath: string,
  format: string | null,
  bytes: number,
  options: { pages?: string; language?: string },
): Promise<DocumentReaderToolResult | null> {
  const ocr = await ocrPdf(filePath, { ...options, maxPages: 20 });
  const body = ocr.pages
    .map(page => `## Page ${page.page}\n${page.text.trim() || '(no text recognized)'}`)
    .join('\n\n');
  if (body.replace(/\s+/g, '').length === 0) return null;
  const truncated = body.length > MAX_MARKDOWN_CHARS;
  const output = truncated ? safeSlice(body, MAX_MARKDOWN_CHARS) : body;
  const header = [
    `Document: ${requestedPath}`,
    'Format: PDF (scanned; text extracted with local OCR)',
    `Pages: ${ocr.renderedCount}/${ocr.pageCount}${ocr.truncated ? ' (page limit reached)' : ''}`,
    truncated
      ? `Output truncated to ${MAX_MARKDOWN_CHARS.toLocaleString()} characters (read ${body.length.toLocaleString()} characters); use a more focused file or split the document.`
      : '',
    '',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    content: [{ type: 'text', text: `${header}\n${output}` }],
    details: {
      path: requestedPath,
      format: format ?? 'pdf',
      bytes,
      source: 'ocr',
      pages: ocr.renderedCount,
      pageCount: ocr.pageCount,
      truncated,
    },
  };
}

export function buildPiDocumentReaderTool(options: {
  workspaceRoot: string;
}): Record<string, unknown> {
  return {
    name: PiDocumentReaderToolName,
    label: 'Read Document',
    description:
      'Read a workspace Office document (.docx, .pptx, .xlsx, .xls), PDF, EPUB, RTF, CSV, or (on Windows) image as structured text/Markdown. ' +
      'Local and read-only; scanned PDFs automatically fall back to local OCR.',
    promptSnippet: 'Read workspace PDF, Office documents, or local OCR text',
    promptGuidelines: [
      'Use `read_document` for Office/PDF documents rather than `read` or shell scripts; use `read` for plain text, source code, and vision-model image inspection.',
      'Local OCR returns text only (not layout, colors, or chart shapes); if OCR returns empty text, report that no readable text was found.',
    ],
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to a document or image relative to the current workspace.',
        },
        pages: {
          type: 'string',
          description:
            'Optional 1-based page range for scanned PDF OCR on Windows (for example "1-5" or "1,3").',
        },
        language: {
          type: 'string',
          description: 'Optional BCP-47 OCR language tag when local OCR runs (default zh-Hans-CN).',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async (
      _toolCallId: string,
      params: Record<string, unknown>,
    ): Promise<DocumentReaderToolResult> => {
      const requestedPath = text(params.path);
      const pages = text(params.pages) || undefined;
      const language = text(params.language) || undefined;
      const filePath = resolveWorkspaceFile(options.workspaceRoot, requestedPath);
      if (!filePath) {
        return {
          content: [
            {
              type: 'text',
              text: 'Document read denied: path must be a file inside the workspace.',
            },
          ],
          details: { errorCode: 'DOCUMENT_PATH_DENIED', path: requestedPath },
        };
      }

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        return {
          content: [{ type: 'text', text: `Document not found: ${requestedPath}` }],
          details: { errorCode: 'DOCUMENT_NOT_FOUND', path: requestedPath },
        };
      }
      if (!stat.isFile()) {
        return {
          content: [
            { type: 'text', text: `Document read denied: ${requestedPath} is not a file.` },
          ],
          details: { errorCode: 'DOCUMENT_NOT_A_FILE', path: requestedPath },
        };
      }
      if (stat.size > MAX_DOCUMENT_BYTES) {
        return {
          content: [
            {
              type: 'text',
              text: `Document read denied: ${requestedPath} is larger than the 50 MiB local conversion limit.`,
            },
          ],
          details: { errorCode: 'DOCUMENT_TOO_LARGE', path: requestedPath, bytes: stat.size },
        };
      }

      const ext = path.extname(filePath).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        return await readImageWithOcr(filePath, requestedPath, language, stat.size);
      }

      const format = formatFromPath(filePath);
      const isPdf = ext === '.pdf';

      try {
        if (isPdf && pages && isOcrSupported()) {
          const ocrResult = await readScannedPdfWithOcr(
            filePath,
            requestedPath,
            format,
            stat.size,
            {
              pages,
              language,
            },
          );
          if (ocrResult) return ocrResult;
        }
        const markdown = await toMarkdown(filePath);
        const plainLength = markdown.replace(/\s+/g, '').length;
        if (isPdf && plainLength < SCANNED_PDF_TEXT_THRESHOLD && isOcrSupported()) {
          // The PDF has no usable text layer: rasterize and OCR it instead of
          // handing the model an empty document.
          try {
            const ocrResult = await readScannedPdfWithOcr(
              filePath,
              requestedPath,
              format,
              stat.size,
              { pages, language },
            );
            if (ocrResult) return ocrResult;
          } catch (error) {
            console.warn(
              '[document-reader] OCR fallback failed:',
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        const truncated = markdown.length > MAX_MARKDOWN_CHARS;
        const output = truncated ? safeSlice(markdown, MAX_MARKDOWN_CHARS) : markdown;
        const header = [
          `Document: ${requestedPath}`,
          `Format: ${format ?? 'auto-detected from document bytes'}`,
          `Local conversion: AnyDoc`,
          truncated
            ? `Output truncated to ${MAX_MARKDOWN_CHARS.toLocaleString()} characters (read ${markdown.length.toLocaleString()} characters); use a more focused file or split the document.`
            : '',
          '',
        ]
          .filter(Boolean)
          .join('\n');
        return {
          content: [{ type: 'text', text: `${header}\n\n${output}` }],
          details: {
            path: requestedPath,
            format,
            bytes: stat.size,
            markdownCharacters: markdown.length,
            truncated,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Unable to read ${requestedPath} as ${format ?? 'an auto-detected format'}: ${message}`,
            },
          ],
          details: {
            errorCode: 'DOCUMENT_CONVERSION_FAILED',
            path: requestedPath,
            format: format ?? null,
          },
        };
      }
    },
  };
}
