import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { fetchMock, getPathMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  getPathMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  session: { defaultSession: { fetch: fetchMock } },
}));

import { downloadUpdate } from './appUpdateInstaller';

describe('downloadUpdate', () => {
  let userDataDir: string;

  beforeEach(async () => {
    userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-update-test-'));
    getPathMock.mockReturnValue(userDataDir);
  });

  afterEach(async () => {
    await fs.promises.rm(userDataDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  test('only returns a final installer after the manifest hash and size match', async () => {
    const body = Buffer.from('verified installer bytes');
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    fetchMock.mockResolvedValue(
      new Response(body, { headers: { 'content-length': String(body.length) } }),
    );

    const result = await downloadUpdate(
      'https://downloads.rongxzyai.com/releases/2026.7.31/test.exe',
      'auto',
      { size: body.length, sha256 },
      () => {},
    );

    expect(result.sha256).toBe(sha256);
    await expect(fs.promises.readFile(result.filePath)).resolves.toEqual(body);
    await expect(fs.promises.access(`${result.filePath}.download`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('removes the partial file and rejects when the manifest hash does not match', async () => {
    const body = Buffer.from('tampered installer bytes');
    fetchMock.mockResolvedValue(
      new Response(body, { headers: { 'content-length': String(body.length) } }),
    );

    await expect(
      downloadUpdate(
        'https://downloads.rongxzyai.com/releases/2026.7.31/test.exe',
        'auto',
        { size: body.length, sha256: '0'.repeat(64) },
        () => {},
      ),
    ).rejects.toThrow('checksum verification failed');

    await expect(fs.promises.readdir(path.join(userDataDir, 'updates'))).resolves.toEqual([]);
  });
});
