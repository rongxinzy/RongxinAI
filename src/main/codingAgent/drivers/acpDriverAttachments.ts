import { readFile, stat } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

import {
  CodingErrorMessage,
  type CodingAgentCapabilities,
  type CodingPromptAttachment,
} from '../../../shared/codingAgent';
import { MAX_INLINE_DATA_LENGTH } from './acpDriverSupport';

const MAX_PROMPT_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.css',
  '.csv',
  '.go',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

/**
 * Turns prompt attachments into ACP content blocks: images the agent supports
 * become inline image blocks, text files become embedded resources when
 * supported, and everything else degrades to a resource link.
 */
export const promptAttachmentBlocks = async (
  attachments: CodingPromptAttachment[] | undefined,
  capabilities: CodingAgentCapabilities,
): Promise<Record<string, unknown>[]> => {
  if (!attachments?.length) return [];
  if (attachments.length > 8) throw new Error(CodingErrorMessage.AttachmentLimit);
  const blocks: Record<string, unknown>[] = [];
  for (const attachment of attachments) {
    if (!path.isAbsolute(attachment.path)) {
      throw new Error(CodingErrorMessage.AttachmentPathAbsolute);
    }
    const filePath = path.resolve(attachment.path);
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) throw new Error(CodingErrorMessage.AttachmentNotFile);
    const extension = path.extname(filePath).toLowerCase();
    const name = path.basename(filePath);
    const uri = pathToFileURL(filePath).toString();
    const imageMimeType = IMAGE_MIME_TYPES[extension];
    if (imageMimeType && capabilities.supportsPromptImages) {
      const data = await readFile(filePath);
      if (data.byteLength > MAX_PROMPT_IMAGE_BYTES) {
        throw new Error(CodingErrorMessage.AttachmentImageTooLarge);
      }
      blocks.push({ type: 'image', uri, mimeType: imageMimeType, data: data.toString('base64') });
      continue;
    }
    if (capabilities.supportsEmbeddedContext && TEXT_EXTENSIONS.has(extension)) {
      const data = await readFile(filePath);
      if (data.byteLength <= MAX_INLINE_DATA_LENGTH) {
        blocks.push({
          type: 'resource',
          resource: { uri, mimeType: 'text/plain', text: data.toString('utf8') },
        });
        continue;
      }
    }
    blocks.push({ type: 'resource_link', uri, name });
  }
  return blocks;
};
