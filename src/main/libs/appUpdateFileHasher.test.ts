import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

import { sha512UpdateFile } from './appUpdateFileHasher';

const temporaryFiles: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryFiles.splice(0).map(file => fs.promises.rm(file, { force: true })));
});

test('rejects paths that cannot be a verified local update', async () => {
  await expect(sha512UpdateFile('relative-update.exe')).rejects.toThrow('Invalid update file path');
  const filePath = path.join(os.tmpdir(), `zhiyuan-empty-update-${process.pid}.exe`);
  temporaryFiles.push(filePath);
  await fs.promises.writeFile(filePath, '');
  await expect(sha512UpdateFile(filePath)).rejects.toThrow('Update file size is invalid');
});

test('rejects a cancelled hash before creating a worker', async () => {
  const filePath = path.join(os.tmpdir(), `zhiyuan-cancelled-update-${process.pid}.exe`);
  temporaryFiles.push(filePath);
  await fs.promises.writeFile(filePath, 'payload');
  const controller = new AbortController();
  controller.abort();
  await expect(sha512UpdateFile(filePath, controller.signal)).rejects.toThrow(
    'Update hash cancelled',
  );
});
