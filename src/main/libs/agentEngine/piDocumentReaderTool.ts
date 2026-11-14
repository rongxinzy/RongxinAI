import * as fs from 'fs';
import path from 'path';

import type { ToolAnnotations, ToolDefinition } from './durableToolTypes';
import { formatFromPath, toMarkdown } from '@firecrawl/anydoc';
import { Type, type Static } from 'typebox';

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

export const PiDocumentReaderParameters = Type.Object({
  path: Type.String({
    description: 'Path to a document or image relative to the current workspace.',
  }),
  pages: Type.Optional(
    Type.String({
      description:
        'Optional 1-based page range for scanned PDF OCR on Windows (for example "1-5" or "1,3").',
    }),
  ),
  language: Type.Optional(
    Type.String({
      description: 'Optional BCP-47 OCR language tag when local OCR runs (default zh-Hans-CN).',
    }),
  ),
});

export const PiDocumentReaderAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
  idempotentHint: true,
};

export const PiDocumentReaderOutputSchema = Type.Object({
  path: Type.String({ description: 'Requested document path.' }),
  text: Type.Optional(
    Type.String({ description: 'Extracted text/Markdown content of the document.' }),
  ),
  format: Type.Optional(
    Type.Union([Type.String(), Type.Null()], { description: 'Document format detected.' }),
  ),
  bytes: Type.Optional(Type.Integer({ description: 'File size in bytes.' })),
  source: Type.Optional(
    Type.String({ description: 'Conversion source (e.g. AnyDoc, local OCR).' }),
  ),
  truncated: Type.Optional(Type.Boolean({ description: 'Whether the output was truncated.' })),
  markdownCharacters: Type.Optional(
    Type.Integer({ description: 'Total character length of the generated Markdown.' }),
  ),
  pages: Type.Optional(Type.Integer({ description: 'Number of rendered pages.' })),
  pageCount: Type.Optional(Type.Integer({ description: 'Total page count in the document.' })),
  engine: Type.Optional(Type.String({ description: 'OCR engine used.' })),
  empty: Type.Optional(Type.Boolean({ description: 'Whether the OCR result was empty.' })),
  lineCount: Type.Optional(Type.Integer({ description: 'Number of OCR recognized lines.' })),
  errorCode: Type.Optional(Type.String({ description: 'Error code if conversion failed.' })),
});
export type PiDocumentReaderOutput = Static<typeof PiDocumentReaderOutputSchema>;

type DocumentReaderToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: PiDocumentReaderOutput;
  structuredContent: PiDocumentReaderOutput;
  isError?: boolean;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function buildOcrFailure(
  errorCode: string,
  message: string,
  requestedPath: string,
): DocumentReaderToolResult {
  const details: PiDocumentReaderOutput = { errorCode, path: requestedPath };
  return {
    content: [{ type: 'text', text: message }],
    details,
    structuredContent: details,
    isError: true,
  };
}

async function readImageWithOcr(
  filePath: string,
  requestedPath: string,
  language: string | undefined,
  bytes: number,
  signal?: AbortSignal,
): Promise<DocumentReaderToolResult> {
  if (signal?.aborted) {
    return buildOcrFailure('DOCUMENT_ABORTED', 'Document reading was cancelled.', requestedPath);
  }
  if (!isOcrSupported()) {
    return buildOcrFailure(
      'OCR_UNSUPPORTED_PLATFORM',
      'Local OCR is currently Windows only; on this platform inspect the image directly when vision input is available.',
      requestedPath,
    );
  }
  const status = await getOcrStatus(language);
  if (signal?.aborted) {
    return buildOcrFailure('DOCUMENT_ABORTED', 'Document reading was cancelled.', requestedPath);
  }
  if (!status.ready) {
    return buildOcrFailure(
      'OCR_ENGINE_UNAVAILABLE',
      'Local Windows OCR language pack is unavailable for this image.',
      requestedPath,
    );
  }
  const result = await readOcrText([filePath], language);
  if (signal?.aborted) {
    return buildOcrFailure('DOCUMENT_ABORTED', 'Document reading was cancelled.', requestedPath);
  }
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
  const details: PiDocumentReaderOutput = {
    path: requestedPath,
    text: output,
    bytes,
    source: 'ocr',
    truncated,
    engine: status.engine,
    empty: result.empty,
    lineCount: result.images.reduce((total, image) => total + image.lines.length, 0),
  };
  return {
    content: [
      {
        type: 'text',
        text: `${header}\n${output || '(no machine-readable text recognized — the image may be a photo, icon, or chart)'}`,
      },
    ],
    details,
    structuredContent: details,
  };
}

async function readScannedPdfWithOcr(
  filePath: string,
  requestedPath: string,
  format: string | null,
  bytes: number,
  options: { pages?: string; language?: string },
  signal?: AbortSignal,
): Promise<DocumentReaderToolResult | null> {
  if (signal?.aborted) return null;
  const ocr = await ocrPdf(filePath, { ...options, maxPages: 20 });
  if (signal?.aborted) return null;
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
  const details: PiDocumentReaderOutput = {
    path: requestedPath,
    text: output,
    format: format ?? 'pdf',
    bytes,
    source: 'ocr',
    pages: ocr.renderedCount,
    pageCount: ocr.pageCount,
    truncated,
  };
  return {
    content: [{ type: 'text', text: `${header}\n${output}` }],
    details,
    structuredContent: details,
  };
}

export function buildPiDocumentReaderTool(options: {
  workspaceRoot: string;
}): ToolDefinition<typeof PiDocumentReaderParameters, PiDocumentReaderOutput> {
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
    parameters: PiDocumentReaderParameters,
    outputSchema: PiDocumentReaderOutputSchema,
    annotations: PiDocumentReaderAnnotations,
    execute: async (
      _toolCallId: string,
      params: { path: string; pages?: string; language?: string },
      signal?: AbortSignal,
    ): Promise<DocumentReaderToolResult> => {
      const requestedPath = text(params.path);
      const pages = text(params.pages) || undefined;
      const language = text(params.language) || undefined;

      if (signal?.aborted) {
        return buildOcrFailure(
          'DOCUMENT_ABORTED',
          'Document reading was cancelled.',
          requestedPath,
        );
      }

      const filePath = resolveWorkspaceFile(options.workspaceRoot, requestedPath);
      if (!filePath) {
        const details: PiDocumentReaderOutput = {
          errorCode: 'DOCUMENT_PATH_DENIED',
          path: requestedPath,
        };
        return {
          content: [
            {
              type: 'text',
              text: 'Document read denied: path must be a file inside the workspace.',
            },
          ],
          details,
          structuredContent: details,
          isError: true,
        };
      }

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        const details: PiDocumentReaderOutput = {
          errorCode: 'DOCUMENT_NOT_FOUND',
          path: requestedPath,
        };
        return {
          content: [{ type: 'text', text: `Document not found: ${requestedPath}` }],
          details,
          structuredContent: details,
          isError: true,
        };
      }
      if (!stat.isFile()) {
        const details: PiDocumentReaderOutput = {
          errorCode: 'DOCUMENT_NOT_A_FILE',
          path: requestedPath,
        };
        return {
          content: [
            { type: 'text', text: `Document read denied: ${requestedPath} is not a file.` },
          ],
          details,
          structuredContent: details,
          isError: true,
        };
      }
      if (stat.size > MAX_DOCUMENT_BYTES) {
        const details: PiDocumentReaderOutput = {
          errorCode: 'DOCUMENT_TOO_LARGE',
          path: requestedPath,
          bytes: stat.size,
        };
        return {
          content: [
            {
              type: 'text',
              text: `Document read denied: ${requestedPath} is larger than the 50 MiB local conversion limit.`,
            },
          ],
          details,
          structuredContent: details,
          isError: true,
        };
      }

      if (signal?.aborted) {
        return buildOcrFailure(
          'DOCUMENT_ABORTED',
          'Document reading was cancelled.',
          requestedPath,
        );
      }

      const ext = path.extname(filePath).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        return await readImageWithOcr(filePath, requestedPath, language, stat.size, signal);
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
            signal,
          );
          if (ocrResult) return ocrResult;
        }
        if (signal?.aborted) {
          return buildOcrFailure(
            'DOCUMENT_ABORTED',
            'Document reading was cancelled.',
            requestedPath,
          );
        }
        const markdown = await toMarkdown(filePath);
        if (signal?.aborted) {
          return buildOcrFailure(
            'DOCUMENT_ABORTED',
            'Document reading was cancelled.',
            requestedPath,
          );
        }
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
              signal,
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
        const details: PiDocumentReaderOutput = {
          path: requestedPath,
          text: output,
          format,
          bytes: stat.size,
          markdownCharacters: markdown.length,
          truncated,
        };
        return {
          content: [{ type: 'text', text: `${header}\n\n${output}` }],
          details,
          structuredContent: details,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const details: PiDocumentReaderOutput = {
          errorCode: 'DOCUMENT_CONVERSION_FAILED',
          path: requestedPath,
          format: format ?? null,
        };
        return {
          content: [
            {
              type: 'text',
              text: `Unable to read ${requestedPath} as ${format ?? 'an auto-detected format'}: ${message}`,
            },
          ],
          details,
          structuredContent: details,
          isError: true,
        };
      }
    },
  };
}
