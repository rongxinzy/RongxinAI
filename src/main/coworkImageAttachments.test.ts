import fs from 'fs';
import { createHash, randomUUID } from 'node:crypto';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deleteCoworkSessionImages,
  persistCoworkImageAttachments,
  persistInlineMessageImages,
  removeAbandonedCoworkImageWrites,
  slimImageAttachmentsForIpc,
} from './coworkImageAttachments';

vi.mock('./workbenchTask/artifactWorkerPool', () => ({
  decodeCoworkImageAsync: async (data: string) => {
    const bytes = Buffer.from(data, 'base64');
    return bytes.length
      ? {
          bytes: Uint8Array.from(bytes).buffer,
          hash: createHash('sha256').update(bytes).digest('hex').slice(0, 32),
        }
      : null;
  },
}));

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const makeRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-images-'));
  roots.push(root);
  return root;
};

describe('cowork image attachments', () => {
  it('writes base64 images to disk and drops the payload', async () => {
    const root = makeRoot();
    const png = Buffer.from('png-bytes');
    const stored = await persistCoworkImageAttachments(root, 'session-1', [
      { name: 'shot.png', mimeType: 'image/png', base64Data: png.toString('base64') },
    ]);

    expect(stored).toEqual([expect.objectContaining({ name: 'shot.png', mimeType: 'image/png' })]);
    expect(stored[0]?.path).toBeTruthy();
    expect(fs.readFileSync(stored[0].path)).toEqual(png);
    expect(JSON.stringify(stored)).not.toContain(png.toString('base64'));
  });

  it('reuses the same file when the same bytes are saved concurrently', async () => {
    const root = makeRoot();
    const attachment = {
      name: 'shot.png',
      mimeType: 'image/png',
      base64Data: Buffer.from('same').toString('base64'),
    };
    const [first, second] = await Promise.all([
      persistCoworkImageAttachments(root, 'session-1', [attachment]),
      persistCoworkImageAttachments(root, 'session-1', [attachment]),
    ]);
    expect(second[0]?.path).toBe(first[0]?.path);
    expect(fs.readFileSync(first[0].path, 'utf8')).toBe('same');
    expect(fs.readdirSync(path.join(root, '.staging'))).toEqual([]);
  });

  it('strips base64 from IPC copies and keeps only a path', () => {
    expect(
      slimImageAttachmentsForIpc([
        { name: 'shot.png', mimeType: 'image/png', base64Data: 'aaaa', path: 'D:/img/a.png' },
      ]),
    ).toEqual([{ name: 'shot.png', mimeType: 'image/png', path: 'D:/img/a.png' }]);
  });

  it('preserves base64 when path is missing to avoid data loss before materialization', () => {
    expect(
      slimImageAttachmentsForIpc([{ name: 'shot.png', mimeType: 'image/png', base64Data: 'aaaa' }]),
    ).toEqual([{ name: 'shot.png', mimeType: 'image/png', path: '', base64Data: 'aaaa' }]);
  });

  it('materializes all legacy images before replacing their inline metadata', async () => {
    const root = makeRoot();
    const metadata = {
      skillIds: ['a'],
      imageAttachments: [
        {
          name: 'shot.png',
          mimeType: 'image/png',
          base64Data: Buffer.from('x').toString('base64'),
        },
      ],
    };
    const result = await persistInlineMessageImages(root, 'session-1', metadata, {});
    expect(result).toMatchObject([{ name: 'shot.png', path: expect.any(String) }]);
    expect(JSON.stringify(result)).not.toContain('base64Data');
    await expect(
      persistInlineMessageImages(
        root,
        'session-1',
        {
          ...metadata,
          imageAttachments: [...metadata.imageAttachments, { name: 'broken.png', base64Data: '!' }],
        },
        {},
      ),
    ).resolves.toBeNull();
  });

  it('removes a session image directory', async () => {
    const root = makeRoot();
    const stored = await persistCoworkImageAttachments(root, 'session-1', [
      { name: 'shot.png', mimeType: 'image/png', base64Data: Buffer.from('x').toString('base64') },
    ]);
    expect(fs.existsSync(stored[0].path)).toBe(true);
    await deleteCoworkSessionImages(root, 'session-1');
    expect(fs.existsSync(path.dirname(stored[0].path))).toBe(false);
  });

  it('does not publish a staged file after its owner was deleted', async () => {
    const root = makeRoot();
    const staged = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const originalWrite = fs.promises.writeFile;
    const delayedWrite = vi
      .spyOn(fs.promises, 'writeFile')
      .mockImplementationOnce(async (...args) => {
        await originalWrite(...args);
        staged.resolve();
        await finish.promise;
      });
    let current = true;
    try {
      const saving = persistCoworkImageAttachments(
        root,
        'session-1',
        [{ name: 'late.png', mimeType: 'image/png', base64Data: 'eA==' }],
        { isCurrent: () => current },
      );
      await staged.promise;
      current = false;
      await deleteCoworkSessionImages(root, 'session-1');
      finish.resolve();

      await expect(saving).rejects.toMatchObject({ name: 'AbortError' });
      expect(fs.existsSync(path.join(root, 'session-1'))).toBe(false);
      expect(fs.readdirSync(path.join(root, '.staging'))).toEqual([]);
    } finally {
      finish.resolve();
      delayedWrite.mockRestore();
    }
  });

  it('cleans interrupted staging on startup without touching published images', async () => {
    const root = makeRoot();
    const [saved] = await persistCoworkImageAttachments(root, 'session-1', [
      { name: 'saved.png', mimeType: 'image/png', base64Data: 'eA==' },
    ]);
    const staged = path.join(root, '.staging', randomUUID());
    fs.writeFileSync(staged, 'interrupted write');

    await removeAbandonedCoworkImageWrites(root);

    expect(fs.existsSync(staged)).toBe(false);
    expect(fs.readFileSync(saved.path, 'utf8')).toBe('x');
  });
});
