import fs from 'node:fs/promises';
import path from 'node:path';

import type { PiContinueOptions } from '../libs/agentEngine/piRuntimeTypes';
import type { IMMediaAttachment } from './types';

export async function toPiAttachments(
  attachments: readonly IMMediaAttachment[] | undefined,
): Promise<Pick<PiContinueOptions, 'imageAttachments' | 'fileAttachments'>> {
  const imageAttachments: NonNullable<PiContinueOptions['imageAttachments']> = [];
  const fileAttachments: NonNullable<PiContinueOptions['fileAttachments']> = [];
  for (const attachment of attachments ?? []) {
    const name = attachment.fileName || path.basename(attachment.localPath);
    if (attachment.type === 'image') {
      imageAttachments.push({
        name,
        mimeType: attachment.mimeType,
        base64Data: (await fs.readFile(attachment.localPath)).toString('base64'),
      });
    } else {
      fileAttachments.push({
        name,
        path: attachment.localPath,
        extension: path.extname(name).slice(1).toLowerCase(),
      });
    }
  }
  return {
    ...(imageAttachments.length > 0 ? { imageAttachments } : {}),
    ...(fileAttachments.length > 0 ? { fileAttachments } : {}),
  };
}
