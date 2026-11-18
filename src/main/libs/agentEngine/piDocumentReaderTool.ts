import * as fs from 'fs';
import path from 'path';

import type { ToolAnnotations, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';

import { safeSlice } from '../../../shared/lib/safeSlice';
import { DOCUMENT_MAX_BYTES, DOCUMENT_MAX_CHARACTERS } from '../../documentReader/constants';
import { queueDocumentRead } from '../../documentReader/documentQueue';
import { readOfficeDocument } from '../../documentReader/officeDocument';
import { readPdfDocument } from '../../documentReader/pdfDocument';
import { resolveWorkspaceFile } from './workspaceFile';
import { getOcrStatus, isOcrSupported, readOcrText } from '../../ocr/ocrEngine';

export const PiDocumentReaderToolName = 'read_document';

export const PI_DOCUMENT_READER_MAX_CHARS = DOCUMENT_MAX_CHARACTERS;
const MAX_MARKDOWN_CHARS = DOCUMENT_MAX_CHARACTERS;
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
      description: 'Optional 1-based PDF page range (for example "1-5" or "1,3").',
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
  source: Type.Optional(Type.String({ description: 'Local text extraction or OCR source.' })),
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

function buildDocumentFailure(
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
    return buildDocumentFailure(
      'DOCUMENT_ABORTED',
      'Document reading was cancelled.',
      requestedPath,
    );
  }
  if (!isOcrSupported()) {
    return buildDocumentFailure(
      'OCR_UNSUPPORTED_PLATFORM',
      'Local OCR is currently Windows only; on this platform inspect the image directly when vision input is available.',
      requestedPath,
    );
  }
  const status = await getOcrStatus(language, signal);
  if (signal?.aborted) {
    return buildDocumentFailure(
      'DOCUMENT_ABORTED',
      'Document reading was cancelled.',
      requestedPath,
    );
  }
  if (!status.ready) {
    return buildDocumentFailure(
      'OCR_ENGINE_UNAVAILABLE',
      'Local Windows OCR language pack is unavailable for this image.',
      requestedPath,
    );
  }
  const result = await readOcrText([filePath], language, signal);
  if (signal?.aborted) {
    return buildDocumentFailure(
      'DOCUMENT_ABORTED',
      'Document reading was cancelled.',
      requestedPath,
    );
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

async function hasPdfHeader(filePath: string): Promise<boolean> {
  const input = await fs.promises.open(filePath, 'r');
  try {
    const signature = Buffer.alloc(5);
    const { bytesRead } = await input.read(signature, 0, signature.length, 0);
    return bytesRead === signature.length && signature.toString('ascii') === '%PDF-';
  } finally {
    await input.close();
  }
}

async function validateDocumentFile(workspaceRoot: string, requestedPath: string) {
  const filePath = resolveWorkspaceFile(workspaceRoot, requestedPath);
  if (!filePath) {
    return {
      failure: buildDocumentFailure(
        'DOCUMENT_PATH_DENIED',
        'Document read denied: path must be a file inside the workspace.',
        requestedPath,
      ),
    };
  }
  const stat = await fs.promises.lstat(filePath).catch((): null => null);
  if (!stat) {
    return {
      failure: buildDocumentFailure(
        'DOCUMENT_NOT_FOUND',
        `Document not found: ${requestedPath}`,
        requestedPath,
      ),
    };
  }
  if (!stat.isFile()) {
    return {
      failure: buildDocumentFailure(
        'DOCUMENT_NOT_A_FILE',
        `Document read denied: ${requestedPath} is not a file.`,
        requestedPath,
      ),
    };
  }
  if (stat.size > DOCUMENT_MAX_BYTES) {
    const failure = buildDocumentFailure(
      'DOCUMENT_TOO_LARGE',
      `Document read denied: ${requestedPath} is larger than the 50 MiB local conversion limit.`,
      requestedPath,
    );
    failure.details.bytes = stat.size;
    return { failure };
  }
  return { filePath, bytes: stat.size };
}

export function buildPiDocumentReaderTool(options: {
  workspaceRoot: string;
}): ToolDefinition<typeof PiDocumentReaderParameters, PiDocumentReaderOutput> {
  return {
    name: PiDocumentReaderToolName,
    label: 'Read Document',
    description:
      'Read a workspace Office document (.doc, .docx, .ppt, .pptx, .xls, .xlsx), PDF, EPUB, RTF, CSV, or (on Windows) image as structured text/Markdown. ' +
      'Local and read-only. On Windows, PDF pages without usable text fall back to local OCR.',
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
        return buildDocumentFailure(
          'DOCUMENT_ABORTED',
          'Document reading was cancelled.',
          requestedPath,
        );
      }

      let format: string | null = null;
      try {
        const result = await queueDocumentRead(async activeSignal => {
          activeSignal.throwIfAborted();
          const validated = await validateDocumentFile(options.workspaceRoot, requestedPath);
          activeSignal.throwIfAborted();
          if (validated.failure) return validated.failure;

          const { filePath, bytes } = validated;
          const ext = path.extname(filePath).toLowerCase();
          if (IMAGE_EXTENSIONS.has(ext)) {
            return await readImageWithOcr(filePath, requestedPath, language, bytes, activeSignal);
          }

          const isPdf = ext === '.pdf' || (await hasPdfHeader(filePath));
          const details: PiDocumentReaderOutput = { path: requestedPath, bytes };
          if (isPdf) {
            format = 'pdf';
            const pdf = await readPdfDocument(filePath, { pages, language }, activeSignal);
            details.text = safeSlice(pdf.markdown, MAX_MARKDOWN_CHARS);
            details.markdownCharacters = pdf.markdown.length;
            details.truncated = pdf.truncated || pdf.markdown.length > MAX_MARKDOWN_CHARS;
            details.source = pdf.source;
            details.pageCount = pdf.pageCount;
            details.pages = pdf.pages;
          } else {
            const office = await readOfficeDocument(filePath, activeSignal);
            format = office.format;
            details.text = office.text;
            details.markdownCharacters = office.markdownCharacters;
            details.truncated = office.markdownCharacters > MAX_MARKDOWN_CHARS;
          }
          activeSignal.throwIfAborted();
          details.format = format;
          const header = [
            `Document: ${requestedPath}`,
            `Format: ${format ?? 'auto-detected from document bytes'}`,
            details.pageCount !== undefined
              ? `Pages read: ${details.pages}/${details.pageCount}`
              : '',
            details.markdownCharacters > MAX_MARKDOWN_CHARS
              ? `Output truncated to ${MAX_MARKDOWN_CHARS.toLocaleString()} characters (read ${details.markdownCharacters.toLocaleString()} characters); use a more focused file or split the document.`
              : details.truncated
                ? 'PDF read limit reached; request a smaller page range to continue.'
                : '',
          ]
            .filter(Boolean)
            .join('\n');
          return {
            content: [{ type: 'text' as const, text: `${header}\n\n${details.text}` }],
            details,
            structuredContent: details,
          };
        }, signal);
        signal?.throwIfAborted();
        return result;
      } catch (error) {
        if (signal?.aborted) {
          return buildDocumentFailure(
            'DOCUMENT_ABORTED',
            'Document reading was cancelled.',
            requestedPath,
          );
        }
        const message = error instanceof Error ? error.message : String(error);
        const details: PiDocumentReaderOutput = {
          errorCode: 'DOCUMENT_CONVERSION_FAILED',
          path: requestedPath,
          format,
        };
        return {
          content: [
            {
              type: 'text',
              text: `Unable to read ${requestedPath} as ${format ?? 'an auto-detected format'}: ${safeSlice(message, 1024)}`,
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
