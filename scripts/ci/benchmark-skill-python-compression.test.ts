import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, test } from 'vitest';

const temporaryDirectories: string[] = [];
const scriptPath = path.join(__dirname, 'benchmark-skill-python-compression.ps1');
const sevenZipPath = require.resolve('7zip-bin/win/x64/7za.exe');
const { packWindowsResourceComponent7z } = require('../electron-builder-hooks.cjs');

function createFixture(changeSourceAfterBaseline = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-skill-python-benchmark-test-'));
  temporaryDirectories.push(root);
  const sourceRoot = path.join(root, 'resources', 'skill-python');
  const componentsRoot = path.join(root, 'build-tar', 'windows-components');
  fs.mkdirSync(path.join(sourceRoot, 'layers', 'shared', 'Scripts'), { recursive: true });
  fs.mkdirSync(componentsRoot, { recursive: true });
  for (let index = 0; index < 40; index += 1) {
    fs.writeFileSync(path.join(sourceRoot, `module-${index}.txt`), 'shared-content-'.repeat(500));
  }
  fs.writeFileSync(path.join(sourceRoot, 'layers', 'shared', 'Scripts', 'python.exe'), 'fixture');
  fs.writeFileSync(path.join(sourceRoot, '说明 [1].txt'), 'literal filename');
  for (const excluded of ['__pycache__/module.pyc', '.cache/probe', 'module.js.map', '.env.test']) {
    const filename = path.join(sourceRoot, excluded);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, 'excluded from production archives');
  }

  const archivePath = path.join(componentsRoot, 'skill-python.7z');
  packWindowsResourceComponent7z(
    { key: 'skill-python', label: 'Skill Python', dir: sourceRoot, prefix: 'skill-python' },
    archivePath,
    sevenZipPath,
  );
  fs.writeFileSync(
    path.join(componentsRoot, 'manifest.json'),
    JSON.stringify({
      components: [
        {
          key: 'skill-python',
          archive: 'skill-python.7z',
          archiveCompression: 'lzma2-mx5-solid-v1',
        },
      ],
    }),
  );
  if (changeSourceAfterBaseline) {
    fs.writeFileSync(path.join(sourceRoot, 'module-0.txt'), 'changed-after-baseline');
  }
  return { root, componentsRoot };
}

function runBenchmark(
  root: string,
  componentsRoot: string,
  options: { minimumSavingsBytes?: number; requireQualified?: boolean } = {},
) {
  return spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-ProjectRoot',
      root,
      '-ComponentsDir',
      componentsRoot,
      '-SevenZipPath',
      sevenZipPath,
      '-ExtractionRuns',
      '1',
      '-MinimumSavingsBytes',
      String(options.minimumSavingsBytes ?? 1),
      '-MaximumExtractionRatio',
      '100',
      '-SkipPythonProbe',
      ...(options.requireQualified ? ['-RequireQualified'] : []),
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform !== 'win32')('shared Skill Python compression benchmark', () => {
  test('qualifies a smaller solid archive with identical extracted content', () => {
    const fixture = createFixture();
    const result = runBenchmark(fixture.root, fixture.componentsRoot);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const report = JSON.parse(
      fs.readFileSync(
        path.join(fixture.componentsRoot, 'skill-python-compression-benchmark.json'),
        'utf8',
      ),
    );
    expect(report.qualified).toBe(true);
    expect(report.savedBytes).toBeGreaterThan(0);
    expect(report.contentSha256Equal).toBe(true);
  });

  test('rejects a solid candidate whose source differs from the packaged baseline', () => {
    const fixture = createFixture(true);
    const result = runBenchmark(fixture.root, fixture.componentsRoot);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('archive entry mismatch');
  });

  test('fails the required CI gate when compression does not meet the threshold', () => {
    const fixture = createFixture();
    const result = runBenchmark(fixture.root, fixture.componentsRoot, {
      minimumSavingsBytes: Number.MAX_SAFE_INTEGER,
      requireQualified: true,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('did not meet the required size and extraction thresholds');
    const report = JSON.parse(
      fs.readFileSync(
        path.join(fixture.componentsRoot, 'skill-python-compression-benchmark.json'),
        'utf8',
      ),
    );
    expect(report.qualified).toBe(false);
  });
});
