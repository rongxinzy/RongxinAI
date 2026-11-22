import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { extractArchiveToDirectory, resolveRuntimeDownloadSources } =
  require('./download-llamacpp-runtime.cjs') as {
    extractArchiveToDirectory: (archivePath: string, extractDir: string) => Promise<void>;
    resolveRuntimeDownloadSources: (
      target: string,
      options: { env: NodeJS.ProcessEnv; allowOfficialFallback?: boolean },
    ) => string[];
  };

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a pinned packaging download can use the official archive when the mirror is unavailable', () => {
  const target = 'linux-x64';
  const mirrorOnly = resolveRuntimeDownloadSources(target, { env: {} });
  const officialOnly = resolveRuntimeDownloadSources(target, { env: { CI: 'true' } });
  expect(resolveRuntimeDownloadSources(target, { env: {}, allowOfficialFallback: true })).toEqual([
    ...mirrorOnly,
    ...officialOnly,
  ]);
  expect(
    resolveRuntimeDownloadSources(target, {
      env: { LLAMACPP_RUNTIME_ALLOW_GITHUB_FALLBACK: '0' },
      allowOfficialFallback: true,
    }),
  ).toEqual(mirrorOnly);
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
