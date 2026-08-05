import * as fs from 'fs';
import path from 'path';

import { formatFromPath, toMarkdown } from '@firecrawl/anydoc';

export const PiDocumentReaderToolName = 'read_document';
export const PiDocumentReaderSystemPrompt = [
  '## Local document reading',
  '',
  '- Use `read_document` for Office, PDF, EPUB, RTF, or CSV files in the workspace when their content is needed.',
  '- It returns local, structured Markdown. For scanned or image-only PDFs, explain that OCR is not available and use an appropriate fallback.',
  '- Use the normal read tool for plain text and source-code files.',
].join('\n');

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_MARKDOWN_CHARS = 1_000_000;

type DocumentReaderToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function resolveWorkspaceDocument(workspaceRoot: string, candidate: string): string | null {
  if (!candidate) return null;
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, candidate);
  const relative = path.relative(root, resolved);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return resolved;
}

export function buildPiDocumentReaderTool(options: {
  workspaceRoot: string;
}): Record<string, unknown> {
  return {
    name: PiDocumentReaderToolName,
    label: 'Read Document',
    description:
      'Read a workspace Office document, PDF, EPUB, RTF, or CSV file as structured Markdown. ' +
      'The conversion is local and read-only; scanned or image-only PDFs require OCR and are not supported.',
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
      const filePath = resolveWorkspaceDocument(options.workspaceRoot, requestedPath);
      if (!filePath) {
        return {
          content: [{ type: 'text', text: 'Document read denied: path must be a file inside the workspace.' }],
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
          content: [{ type: 'text', text: `Document read denied: ${requestedPath} is not a file.` }],
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
          content: [{ type: 'text', text: `${header}${output}` }],
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
          details: { errorCode: 'DOCUMENT_CONVERSION_FAILED', path: requestedPath, format: format ?? null },
        };
      }
    },
  };
}
