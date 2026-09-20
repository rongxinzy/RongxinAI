import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  deleteCoworkSessionImages,
  persistCoworkImageAttachments,
  persistMessageImageMetadata,
  slimImageAttachmentsForIpc,
} from './coworkImageAttachments';

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
  it('writes base64 images to disk and drops the payload', () => {
    const root = makeRoot();
    const png = Buffer.from('png-bytes');
    const stored = persistCoworkImageAttachments(root, 'session-1', [
      { name: 'shot.png', mimeType: 'image/png', base64Data: png.toString('base64') },
    ]);

    expect(stored).toEqual([
      expect.objectContaining({ name: 'shot.png', mimeType: 'image/png' }),
    ]);
    expect(stored[0]?.path).toBeTruthy();
    expect(fs.readFileSync(stored[0].path)).toEqual(png);
    expect(JSON.stringify(stored)).not.toContain(png.toString('base64'));
  });

  it('reuses the same file when the same bytes are saved again', () => {
    const root = makeRoot();
    const attachment = {
      name: 'shot.png',
      mimeType: 'image/png',
      base64Data: Buffer.from('same').toString('base64'),
    };
    const first = persistCoworkImageAttachments(root, 'session-1', [attachment]);
    const second = persistCoworkImageAttachments(root, 'session-1', [attachment]);
    expect(second[0]?.path).toBe(first[0]?.path);
  });

  it('strips base64 from IPC copies and keeps only a path', () => {
    expect(
      slimImageAttachmentsForIpc([
        { name: 'shot.png', mimeType: 'image/png', base64Data: 'aaaa', path: 'D:/img/a.png' },
      ]),
    ).toEqual([{ name: 'shot.png', mimeType: 'image/png', path: 'D:/img/a.png' }]);
  });

  it('rewrites message metadata when inline images are present', () => {
    const root = makeRoot();
    const result = persistMessageImageMetadata(root, 'session-1', {
      skillIds: ['a'],
      imageAttachments: [
        { name: 'shot.png', mimeType: 'image/png', base64Data: Buffer.from('x').toString('base64') },
      ],
    });
    expect(result.changed).toBe(true);
    expect(result.metadata?.skillIds).toEqual(['a']);
    expect(JSON.stringify(result.metadata)).not.toContain('base64Data');
  });

  it('removes a session image directory', () => {
    const root = makeRoot();
    const stored = persistCoworkImageAttachments(root, 'session-1', [
      { name: 'shot.png', mimeType: 'image/png', base64Data: Buffer.from('x').toString('base64') },
    ]);
    expect(fs.existsSync(stored[0].path)).toBe(true);
    deleteCoworkSessionImages(root, 'session-1');
    expect(fs.existsSync(path.dirname(stored[0].path))).toBe(false);
  });
});
