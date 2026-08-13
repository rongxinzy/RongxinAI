import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, test } from 'vitest';

import {
  configureMacAutoUpdateMetadata,
  packWindowsResourceComponent7z,
} from '../scripts/electron-builder-hooks.cjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('electron-builder packaging hooks', () => {
  test('marks macOS automatic installation disabled unless signing explicitly enables it', () => {
    const context = {
      electronPlatformName: 'darwin',
      packager: { config: { extraMetadata: { retained: true } } },
    };

    configureMacAutoUpdateMetadata(context, {});
    expect(context.packager.config.extraMetadata).toEqual({
      retained: true,
      zhiyuanMacAutoUpdateEnabled: false,
    });

    configureMacAutoUpdateMetadata(context, { ZHIYUAN_MAC_AUTO_UPDATE_ENABLED: 'true' });
    expect(context.packager.config.extraMetadata).toEqual({
      retained: true,
      zhiyuanMacAutoUpdateEnabled: true,
    });
  });
});

describe.skipIf(process.platform !== 'win32')('Windows component archive creation', () => {
  test('replaces an existing archive and applies the selected solid profile', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-component-pack-test-'));
    temporaryDirectories.push(root);
    const componentRoot = path.join(root, 'component-source');
    const archivePath = path.join(root, 'portable-git.7z');
    const sevenZipPath = require.resolve('7zip-bin/win/x64/7za.exe');
    fs.mkdirSync(componentRoot);
    fs.writeFileSync(path.join(componentRoot, 'current.txt'), 'current');
    fs.writeFileSync(path.join(componentRoot, 'second.txt'), 'second');

    const oldSource = path.join(root, 'old-source');
    fs.mkdirSync(oldSource);
    fs.writeFileSync(path.join(oldSource, 'stale.txt'), 'stale');
    const oldArchive = spawnSync(
      sevenZipPath,
      ['a', '-t7z', '-mx=1', '-ms=off', archivePath, 'old-source'],
      { cwd: root, encoding: 'utf8' },
    );
    expect(oldArchive.status).toBe(0);

    packWindowsResourceComponent7z(
      {
        key: 'portable-git',
        label: 'PortableGit runtime',
        dir: componentRoot,
        prefix: 'mingit',
        sentinel: 'mingit/current.txt',
      },
      archivePath,
      sevenZipPath,
    );

    const listing = spawnSync(sevenZipPath, ['l', '-slt', archivePath], { encoding: 'utf8' });
    expect(listing.status).toBe(0);
    expect(listing.stdout).toContain('Solid = +');
    expect(listing.stdout).toContain('Path = mingit\\current.txt');
    expect(listing.stdout).not.toContain('stale.txt');
  });
});
