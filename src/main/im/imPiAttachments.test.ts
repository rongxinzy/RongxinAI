import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { toPiAttachments } from './imPiAttachments';

const testRoot = path.join(process.cwd(), '.tmp-im-pi-attachments-test');

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

test('projects channel images and files into Pi-native attachment options', async () => {
  await fs.mkdir(testRoot, { recursive: true });
  const imagePath = path.join(testRoot, 'image.png');
  const filePath = path.join(testRoot, 'report.pdf');
  await fs.writeFile(imagePath, 'image');
  await fs.writeFile(filePath, 'report');
  await expect(
    toPiAttachments([
      { type: 'image', localPath: imagePath, mimeType: 'image/png', fileName: 'image.png' },
      {
        type: 'document',
        localPath: filePath,
        mimeType: 'application/pdf',
        fileName: 'report.pdf',
      },
    ]),
  ).resolves.toEqual({
    imageAttachments: [{ name: 'image.png', mimeType: 'image/png', base64Data: 'aW1hZ2U=' }],
    fileAttachments: [{ name: 'report.pdf', path: filePath, extension: 'pdf' }],
  });
});
