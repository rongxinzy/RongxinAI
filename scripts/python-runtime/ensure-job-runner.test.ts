import fs from 'node:fs';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { ensureWindowsJobRunner, isJobRunnerFresh } = require('./ensure-job-runner.cjs');

describe('ensure-job-runner', () => {
  it('skips non-Windows hosts without spawning', () => {
    const spawnSync = vi.fn();
    expect(ensureWindowsJobRunner({ platform: 'darwin', spawnSync })).toEqual({
      status: 'skipped',
      outputPath: null,
    });
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('builds job-runner.exe when missing and skips subsequent runs while fresh', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'job-runner-ensure-'));
    try {
      const outputPath = join(dir, 'job-runner.exe');
      const sourcePath = join(dir, 'job-runner.cpp');
      const buildScriptPath = join(dir, 'build-job-runner.ps1');
      await writeFile(sourcePath, 'int wmain() { return 0; }');
      await writeFile(buildScriptPath, 'exit 0');

      const spawnSync = vi.fn(() => {
        fs.writeFileSync(outputPath, Buffer.from('MZ'));
        return { status: 0 };
      });

      const first = ensureWindowsJobRunner({
        platform: 'win32',
        projectRoot: dir,
        outputPath,
        sourcePath,
        buildScriptPath,
        spawnSync,
      });
      expect(first).toEqual({ status: 'built', outputPath });
      expect(spawnSync).toHaveBeenCalledTimes(1);

      const second = ensureWindowsJobRunner({
        platform: 'win32',
        projectRoot: dir,
        outputPath,
        sourcePath,
        buildScriptPath,
        spawnSync,
      });
      expect(second).toEqual({ status: 'fresh', outputPath });
      expect(spawnSync).toHaveBeenCalledTimes(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('treats binary older than source as stale and raises clear error on build failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'job-runner-stale-'));
    try {
      const outputPath = join(dir, 'job-runner.exe');
      const sourcePath = join(dir, 'job-runner.cpp');
      const buildScriptPath = join(dir, 'build-job-runner.ps1');
      await writeFile(outputPath, 'MZ');
      await writeFile(sourcePath, 'int wmain() { return 0; }');
      await writeFile(buildScriptPath, 'exit 0');

      const older = new Date(Date.now() - 10_000);
      const newer = new Date(Date.now());
      await utimes(outputPath, older, older);
      await utimes(sourcePath, newer, newer);

      expect(isJobRunnerFresh({ outputPath, sourcePath, buildScriptPath })).toBe(false);

      const spawnSync = vi.fn().mockReturnValue({ status: 1 });
      expect(() =>
        ensureWindowsJobRunner({
          platform: 'win32',
          projectRoot: dir,
          outputPath,
          sourcePath,
          buildScriptPath,
          spawnSync,
        }),
      ).toThrow('bun run python:build:job-runner');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
