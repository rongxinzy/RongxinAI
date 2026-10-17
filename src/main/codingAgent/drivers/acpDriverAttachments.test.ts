import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { expect, test } from 'vitest';

import type { CodingAgentCapabilities } from '../../../shared/codingAgent';
import { promptAttachmentBlocks } from './acpDriverAttachments';

const capabilities = (
  overrides: Pick<CodingAgentCapabilities, 'supportsPromptImages' | 'supportsEmbeddedContext'>,
): CodingAgentCapabilities => ({
  supportsLoadSession: false,
  supportsResumeSession: false,
  supportsPlans: false,
  supportsPermissions: false,
  supportsFilesystem: false,
  supportsTerminal: false,
  supportsConfigOptions: false,
  supportsUsage: false,
  supportsElicitation: false,
  ...overrides,
});

test('returns no blocks without attachments', async () => {
  await expect(promptAttachmentBlocks(undefined, capabilities({}))).resolves.toEqual([]);
  await expect(promptAttachmentBlocks([], capabilities({}))).resolves.toEqual([]);
});

test('rejects relative paths, directories, and more than eight attachments', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'acp-attachments-'));
  try {
    await expect(
      promptAttachmentBlocks([{ name: 'notes.txt', path: 'notes.txt' }], capabilities({})),
    ).rejects.toThrow('Attached file path must be absolute.');
    await expect(
      promptAttachmentBlocks([{ name: 'dir', path: workspaceRoot }], capabilities({})),
    ).rejects.toThrow('Attached path is not a regular file.');
    const many = Array.from({ length: 9 }, (_, index) => ({
      name: `file-${index}.txt`,
      path: path.join(workspaceRoot, `file-${index}.txt`),
    }));
    await expect(promptAttachmentBlocks(many, capabilities({}))).rejects.toThrow(
      'At most 8 attachments',
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('sends supported images as inline image blocks', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'acp-attachments-'));
  try {
    const imagePath = path.join(workspaceRoot, 'screenshot.png');
    await writeFile(imagePath, 'shot');
    const blocks = await promptAttachmentBlocks(
      [{ name: 'screenshot.png', path: imagePath }],
      capabilities({ supportsPromptImages: true }),
    );
    expect(blocks).toEqual([
      {
        type: 'image',
        uri: pathToFileURL(imagePath).toString(),
        mimeType: 'image/png',
        data: Buffer.from('shot').toString('base64'),
      },
    ]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects supported images above the 10 MB limit', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'acp-attachments-'));
  try {
    const imagePath = path.join(workspaceRoot, 'huge.png');
    await writeFile(imagePath, Buffer.alloc(10 * 1024 * 1024 + 1, 1));
    await expect(
      promptAttachmentBlocks(
        [{ name: 'huge.png', path: imagePath }],
        capabilities({ supportsPromptImages: true }),
      ),
    ).rejects.toThrow('Attached image exceeds the 10 MB limit.');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('embeds small text files and links oversized or unsupported ones', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'acp-attachments-'));
  try {
    const smallPath = path.join(workspaceRoot, 'notes.txt');
    const hugePath = path.join(workspaceRoot, 'huge.txt');
    const imagePath = path.join(workspaceRoot, 'shot.png');
    await writeFile(smallPath, 'note');
    await writeFile(hugePath, 'x'.repeat(200_001));
    await writeFile(imagePath, 'shot');

    const embeddedBlocks = await promptAttachmentBlocks(
      [{ name: 'notes.txt', path: smallPath }],
      capabilities({ supportsEmbeddedContext: true }),
    );
    expect(embeddedBlocks).toEqual([
      {
        type: 'resource',
        resource: {
          uri: pathToFileURL(smallPath).toString(),
          mimeType: 'text/plain',
          text: 'note',
        },
      },
    ]);

    const oversized = await promptAttachmentBlocks(
      [{ name: 'huge.txt', path: hugePath }],
      capabilities({ supportsEmbeddedContext: true }),
    );
    expect(oversized).toEqual([
      { type: 'resource_link', uri: pathToFileURL(hugePath).toString(), name: 'huge.txt' },
    ]);

    const withoutImageSupport = await promptAttachmentBlocks(
      [{ name: 'shot.png', path: imagePath }],
      capabilities({ supportsEmbeddedContext: true }),
    );
    expect(withoutImageSupport).toEqual([
      { type: 'resource_link', uri: pathToFileURL(imagePath).toString(), name: 'shot.png' },
    ]);

    const withoutEmbeddedContext = await promptAttachmentBlocks(
      [{ name: 'notes.txt', path: smallPath }],
      capabilities({}),
    );
    expect(withoutEmbeddedContext).toEqual([
      { type: 'resource_link', uri: pathToFileURL(smallPath).toString(), name: 'notes.txt' },
    ]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
