import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { extractArchiveToDirectory } = require('./download-llamacpp-runtime.cjs') as {
  extractArchiveToDirectory: (archivePath: string, extractDir: string) => Promise<void>;
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')(
  'extracts zip archives with native Windows bsdtar',
  async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'llama runtime '));
    temporaryDirectories.push(temporaryDirectory);
    const archivePath = path.join(temporaryDirectory, 'runtime archive.zip');
    const extractDir = path.join(temporaryDirectory, 'extract');
    const archive = new JSZip();
    archive.file('bin/llama-server.exe', 'runtime');
    archive.file('bin/ggml.dll', 'library');
    fs.writeFileSync(archivePath, await archive.generateAsync({ type: 'nodebuffer' }));
    fs.mkdirSync(extractDir);

    await extractArchiveToDirectory(archivePath, extractDir);

    expect(fs.readFileSync(path.join(extractDir, 'bin', 'llama-server.exe'), 'utf8')).toBe(
      'runtime',
    );
    expect(fs.readFileSync(path.join(extractDir, 'bin', 'ggml.dll'), 'utf8')).toBe('library');
  },
);
