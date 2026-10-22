import * as fs from 'fs';

import { formatFromPath, toMarkdown } from '@firecrawl/anydoc';

import { resolveWorkspaceFile } from '../../workbenchTask/artifactCollector';
import { isOcrSupported } from '../../ocr/ocrEngine';
import { ocrPdf } from '../../ocr/pdfOcr';

export const PiDocumentReaderToolName = 'read_document';
export const PiDocumentReaderSystemPrompt = [
  '## Local document reading',
  '',
  '- Use `read_document` for Office, PDF, EPUB, RTF, or CSV files in the workspace when their content is needed.',
  '- It returns local, structured Markdown. A PDF whose pages have no text layer is automatically re-read with local OCR; the result marks the source.',
  '- OCR text has no layout: do not describe colors, fonts, or chart shapes from it.',
  '- Use the normal read tool for plain text and source-code files.',
].join('\n');

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_MARKDOWN_CHARS = 1_000_000;
/** Below this many non-whitespace characters a PDF is treated as image-only. */
const SCANNED_PDF_TEXT_THRESHOLD = 80;

type DocumentReaderToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function buildPiDocumentReaderTool(options: {
  workspaceRoot: string;
}): Record<string, unknown> {
  return {
    name: PiDocumentReaderToolName,
    label: 'Read Document',
    description:
      'Read a workspace Office document, PDF, EPUB, RTF, or CSV file as structured Markdown. ' +
      'The conversion is local and read-only. A PDF without a text layer is re-read with local OCR.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to a document relative to the current workspace.',
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

      const format = formatFromPath(filePath);

      try {
        const markdown = await toMarkdown(filePath);
        const plainLength = markdown.replace(/\s+/g, '').length;
        const isPdf = filePath.toLowerCase().endsWith('.pdf');
        if (isPdf && plainLength < SCANNED_PDF_TEXT_THRESHOLD && isOcrSupported()) {
          // The PDF has no usable text layer: rasterize and OCR it instead of
          // handing the model an empty document.
          try {
            const ocr = await ocrPdf(filePath, { maxPages: 20 });
            const body = ocr.pages
              .map(page => `## Page ${page.page}\n${page.text.trim() || '(no text recognized)'}`)
              .join('\n\n');
            if (body.replace(/\s+/g, '').length > 0) {
              const truncated = body.length > MAX_MARKDOWN_CHARS;
              const output = truncated ? body.slice(0, MAX_MARKDOWN_CHARS) : body;
              const header = [
                `Document: ${requestedPath}`,
                'Format: PDF (scanned; text extracted with local OCR)',
                `Pages: ${ocr.renderedCount}/${ocr.pageCount}${ocr.truncated ? ' (page limit reached)' : ''}`,
                '',
              ].join('\n');
              return {
                content: [{ type: 'text', text: `${header}\n${output}` }],
                details: {
                  path: requestedPath,
                  format: format ?? 'pdf',
                  bytes: stat.size,
                  source: 'ocr',
                  pages: ocr.renderedCount,
                  pageCount: ocr.pageCount,
                  truncated,
                },
              };
            }
          } catch (error) {
            console.warn(
              '[document-reader] OCR fallback failed:',
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        const truncated = markdown.length > MAX_MARKDOWN_CHARS;
        const output = truncated ? markdown.slice(0, MAX_MARKDOWN_CHARS) : markdown;
        const header = [
          `Document: ${requestedPath}`,
          `Format: ${format ?? 'auto-detected from document bytes'}`,
          `Local conversion: AnyDoc`,
          truncated
            ? `Output truncated to ${MAX_MARKDOWN_CHARS.toLocaleString()} characters; use a more focused file or split the document.`
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
