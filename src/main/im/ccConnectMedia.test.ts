import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { buildCcConnectTurnResponse, persistCcConnectMedia } from './ccConnectMedia';

const testRoot = path.join(process.cwd(), '.tmp-cc-connect-media-test');

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

test('persists inbound media inside the bound workspace with safe names', async () => {
  await fs.mkdir(testRoot, { recursive: true });
  const attachments = await persistCcConnectMedia({
    workspacePath: testRoot,
    accountId: 'account/one',
    messageId: '../message',
    images: [{ MimeType: 'image/png', Data: 'aW1hZ2U=', FileName: '..\\chart.png' }],
    files: [{ MimeType: 'text/plain', Data: 'cmVwb3J0', FileName: '../report.txt' }],
  });
  expect(attachments).toHaveLength(2);
  for (const attachment of attachments) {
    expect(path.relative(testRoot, attachment.localPath)).not.toMatch(/^\.\./);
    await expect(fs.readFile(attachment.localPath)).resolves.toBeInstanceOf(Buffer);
  }
  expect(attachments.map(item => item.fileName)).toEqual(['chart.png', 'report.txt']);
});

test('rejects malformed inbound base64 before writing files', async () => {
  await fs.mkdir(testRoot, { recursive: true });
  await expect(
    persistCcConnectMedia({
      workspacePath: testRoot,
      accountId: 'account',
      messageId: 'message',
      images: [{ MimeType: 'image/png', Data: 'not-base64!', FileName: 'image.png' }],
    }),
  ).rejects.toThrow('base64');
});

test('rejects non-canonical base64 instead of accepting a partial decode', async () => {
  await fs.mkdir(testRoot, { recursive: true });
  await expect(
    persistCcConnectMedia({
      workspacePath: testRoot,
      accountId: 'account',
      messageId: 'message',
      files: [{ MimeType: 'text/plain', Data: 'abcde', FileName: 'partial.txt' }],
    }),
  ).rejects.toThrow('base64');
});

test('rejects a linked attachment directory before writing outside the workspace', async () => {
  await fs.mkdir(testRoot, { recursive: true });
  const outside = `${testRoot}-outside`;
  await fs.mkdir(outside, { recursive: true });
  try {
    await fs.symlink(outside, path.join(testRoot, '.zhiyuan'), 'junction');
    await expect(
      persistCcConnectMedia({
        workspacePath: testRoot,
        accountId: 'account',
        messageId: 'message',
        images: [{ MimeType: 'image/png', Data: 'aW1hZ2U=', FileName: 'image.png' }],
      }),
    ).rejects.toThrow('real directories');
    await expect(fs.readdir(outside)).resolves.toEqual([]);
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('returns structured local attachments and removes only accepted markers', async () => {
  await fs.mkdir(testRoot, { recursive: true });
  const filePath = path.join(testRoot, 'result.png');
  await fs.writeFile(filePath, 'image');
  const response = await buildCcConnectTurnResponse(`Done\n![result](${filePath})`);
  expect(response).toEqual({
    content: 'Done',
    attachments: [{ kind: 'image', path: filePath, fileName: 'result' }],
  });
});
