'use strict';

const path = require('node:path');
const os = require('node:os');
const { existsSync, mkdtempSync, rmSync, renameSync, symlinkSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { getWindowsResourceArchiveCompression } = require('../windows-resource-pack.cjs');

function resolveWindows7zaPath() {
  const sevenZipPath = path.join(
    __dirname,
    '..',
    '..',
    'node_modules',
    '7zip-bin',
    'win',
    'x64',
    '7za.exe',
  );
  if (!existsSync(sevenZipPath)) {
    throw new Error(
      '[electron-builder-hooks] Missing bundled Windows 7za.exe. Run bun install before packaging.',
    );
  }
  return sevenZipPath;
}

function packWindowsResourceComponent7z(component, archivePath, sevenZipPath) {
  const stagingRoot = mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-component-7z-'));
  const stagedPrefix = path.join(stagingRoot, component.prefix);
  const temporaryArchivePath = `${archivePath}.${process.pid}.packing`;
  try {
    // A junction keeps the archive layout stable without copying a multi-hundred-MB
    // component into a temporary staging directory.  The archive is created from
    // the relative prefix only, so it never contains an absolute build-machine path.
    symlinkSync(component.dir, stagedPrefix, 'junction');
    const compression = getWindowsResourceArchiveCompression(component);
    rmSync(temporaryArchivePath, { force: true });
    const result = spawnSync(
      sevenZipPath,
      ['a', '-t7z', ...compression.sevenZipArgs, temporaryArchivePath, component.prefix],
      {
        cwd: stagingRoot,
        encoding: 'utf8',
      },
    );
    if (result.error || result.status !== 0) {
      throw new Error(
        '[electron-builder-hooks] Failed to create ' +
          component.key +
          ' .7z archive: ' +
          (result.error?.message || result.stderr || result.stdout || `exit ${result.status}`),
      );
    }
    rmSync(archivePath, { force: true });
    renameSync(temporaryArchivePath, archivePath);
  } finally {
    rmSync(temporaryArchivePath, { force: true });
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

module.exports = { resolveWindows7zaPath, packWindowsResourceComponent7z };
