import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  WINDOWS_RESOURCE_ARCHIVE_COMPRESSION,
  buildWindowsResourceComponentManifest,
  computeWindowsResourceComponentId,
  getWindowsResourceArchiveCompression,
  getWindowsResourceComponents,
  isWindowsResourceComponentReusable,
  listWindowsResourceComponentFiles,
  sha256File,
} = require('./windows-resource-pack.cjs');
const { packWindowsResourceComponent7z } = require('./electron-builder-hooks.cjs');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-win-resource-'));
  roots.push(root);
  const component = {
    key: 'mcps',
    label: 'Built-in MCPs',
    dir: path.join(root, 'source'),
    prefix: 'MCPs',
    sentinel: 'MCPs/compatibility-review.md',
  };
  const write = (relative: string, text = 'fixture') => {
    const file = path.join(component.dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  return { root, component, write, archive: path.join(root, 'archive.7z') };
}

describe('Windows resource archive compression', () => {
  const components = getWindowsResourceComponents('C:\\project');
  const compressionFor = (key: string) =>
    getWindowsResourceArchiveCompression(components.find(component => component.key === key));

  test.each(['python', 'skill-python'])('uses solid LZMA2 for %s', key => {
    expect(compressionFor(key)).toBe(WINDOWS_RESOURCE_ARCHIVE_COMPRESSION.Solid);
  });

  test.each(['skills', 'mcps'])('bounds solid compression for frequently changed %s', key => {
    expect(compressionFor(key)).toBe(WINDOWS_RESOURCE_ARCHIVE_COMPRESSION.BoundedSolid);
  });

  test.each(['channel-runtime', 'uv'])('uses non-solid LZMA2 for %s', key => {
    expect(compressionFor(key)).toBe(WINDOWS_RESOURCE_ARCHIVE_COMPRESSION.NonSolid);
  });
});

test('hashes and archives the same exact files with the bundled 7za', () => {
  const { root, component, write, archive } = createFixture();
  const { path7za: binary } = require('7zip-bin');
  const sevenZip = path.join(root, path.basename(binary));
  fs.copyFileSync(binary, sevenZip);
  if (process.platform !== 'win32') fs.chmodSync(sevenZip, 0o755);

  const literal = process.platform === 'win32' ? '说明 [1].md' : '说明 [1]?*.md';
  const included = [
    'compatibility-review.md',
    `pkg/${literal}`,
    'pkg/LICENSE',
    'pkg/NOTICE.txt',
    'pkg/package.json',
    'pkg/dist/index.d.ts',
    'pkg/node_modules/.bin/tool.cmd',
    'pkg/tests/runtime-data.json',
    'pkg/tokens.py',
    'python/Lib/site-packages/runtime/__init__.py',
    'python/Scripts/python3.exe',
  ];
  const excluded = [
    '.env.dev',
    'pkg/.connection',
    'pkg/.server.log',
    'pkg/.server.pid',
    'pkg/main.js.map',
    'pkg/provider.token.json',
    'pkg/settings.local.json',
    'pkg/.cache/snapshot',
    'pkg/.git/config',
    'pkg/__pycache__/entry.pyc',
    'pkg/.venv/Scripts/python.exe',
    'feishu/runtime/temporary',
  ];
  for (const file of [...included, ...excluded]) write(file, file);

  const files = listWindowsResourceComponentFiles(component);
  expect(files).toEqual(included.sort());
  const id = computeWindowsResourceComponentId(component, files);
  write('pkg/.connection', 'changed excluded marker');
  expect(computeWindowsResourceComponentId(component)).toBe(id);
  write('pkg/LICENSE', 'new included license');
  expect(computeWindowsResourceComponentId(component, files)).not.toBe(id);
  write('pkg/LICENSE', 'pkg/LICENSE');
  write('added-after-listing.txt');

  packWindowsResourceComponent7z(component, archive, sevenZip, files);
  const digest = sha256File(archive);
  for (const file of files) {
    fs.utimesSync(path.join(component.dir, file), new Date(0), new Date('2026-01-01'));
  }
  packWindowsResourceComponent7z(component, archive, sevenZip, files);
  expect(sha256File(archive)).toBe(digest);
  const output = path.join(root, 'expanded');
  execFileSync(sevenZip, ['x', '-y', `-o${output}`, archive]);
  const extracted = path.join(output, component.prefix);
  const extractedFiles = fs
    .readdirSync(extracted, { recursive: true })
    .filter(file => fs.statSync(path.join(extracted, file)).isFile())
    .map(file => file.split(path.sep).join('/'));
  expect(extractedFiles.sort()).toEqual(files);
  expect(fs.readdirSync(output)).toEqual([component.prefix]);
  expect(fs.readFileSync(path.join(extracted, 'pkg', literal), 'utf8')).toBe(`pkg/${literal}`);

  const manifestPath = path.join(root, 'manifest.json');
  const manifest = buildWindowsResourceComponentManifest(
    component,
    id,
    sha256File(archive),
    fs.statSync(archive).size,
    sha256File(path.join(extracted, 'compatibility-review.md')),
  );
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  expect(isWindowsResourceComponentReusable(manifestPath, archive, id, component)).toBe(true);
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: 4 }));
  expect(isWindowsResourceComponentReusable(manifestPath, archive, id, component)).toBe(false);
});

test('rejects a resource component with no archivable files before running 7za', () => {
  const { component, write, archive } = createFixture();
  write('.env');
  expect(() => packWindowsResourceComponent7z(component, archive, 'unused')).toThrow(
    'No files to archive for mcps',
  );
  expect(fs.existsSync(archive)).toBe(false);
});
