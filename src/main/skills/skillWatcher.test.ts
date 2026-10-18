import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

import { isSkillDefinitionChange, SkillWatcher } from './skillWatcher';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeRootDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-watcher-'));
  tempDirs.push(dir);
  return dir;
}

describe('isSkillDefinitionChange', () => {
  const cases: Array<{
    name: string;
    relativePath: string | null;
    platform: NodeJS.Platform;
    expected: boolean;
  }> = [
    // Null filename: notify on non-Windows, ignore on Windows.
    { name: 'null on linux notifies', relativePath: null, platform: 'linux', expected: true },
    { name: 'null on darwin notifies', relativePath: null, platform: 'darwin', expected: true },
    { name: 'null on win32 is ignored', relativePath: null, platform: 'win32', expected: false },
    // Hidden first segment is always ignored.
    { name: 'hidden dir file', relativePath: '.git/config', platform: 'linux', expected: false },
    { name: 'hidden root file', relativePath: '.DS_Store', platform: 'darwin', expected: false },
    {
      name: 'hidden skill-level file',
      relativePath: '.cache/data.bin',
      platform: 'win32',
      expected: false,
    },
    // Root-level entries.
    {
      name: 'root config file',
      relativePath: 'skills.config.json',
      platform: 'linux',
      expected: true,
    },
    {
      name: 'root config file with windows separators',
      relativePath: 'skills.config.json',
      platform: 'win32',
      expected: true,
    },
    { name: 'root skill dir added', relativePath: 'my-skill', platform: 'linux', expected: true },
    {
      name: 'root skill dir added with windows separators',
      relativePath: 'my-skill',
      platform: 'win32',
      expected: true,
    },
    {
      name: 'root file with extension ignored',
      relativePath: 'README.md',
      platform: 'linux',
      expected: false,
    },
    {
      name: 'root dotfile with extension ignored',
      relativePath: 'notes.txt',
      platform: 'darwin',
      expected: false,
    },
    // Skill definition files.
    {
      name: 'skill SKILL.md',
      relativePath: 'my-skill/SKILL.md',
      platform: 'linux',
      expected: true,
    },
    {
      name: 'skill SKILL.md with windows separators',
      relativePath: 'my-skill\\SKILL.md',
      platform: 'win32',
      expected: true,
    },
    {
      name: 'skill config file',
      relativePath: 'my-skill/skills.config.json',
      platform: 'linux',
      expected: true,
    },
    {
      name: 'skill config with windows separators',
      relativePath: 'my-skill\\skills.config.json',
      platform: 'win32',
      expected: true,
    },
    // .rongx (zhiyuan) metadata dir definition files.
    {
      name: 'rongx SKILL.md',
      relativePath: 'my-skill/zhiyuan/SKILL.md',
      platform: 'linux',
      expected: true,
    },
    {
      name: 'rongx SKILL.md with windows separators',
      relativePath: 'my-skill\\zhiyuan\\SKILL.md',
      platform: 'win32',
      expected: true,
    },
    {
      name: 'rongx config file',
      relativePath: 'my-skill/zhiyuan/skills.config.json',
      platform: 'darwin',
      expected: true,
    },
    {
      name: 'rongx metadata file ignored',
      relativePath: 'my-skill/zhiyuan/metadata.yaml',
      platform: 'linux',
      expected: false,
    },
    // Everything else is ignored.
    {
      name: 'deep cache file',
      relativePath: 'my-skill/cache/data.json',
      platform: 'linux',
      expected: false,
    },
    {
      name: 'deep cache file with windows separators',
      relativePath: 'my-skill\\cache\\data.json',
      platform: 'win32',
      expected: false,
    },
    {
      name: 'skill data file',
      relativePath: 'my-skill/notes.txt',
      platform: 'linux',
      expected: false,
    },
    {
      name: 'nested script',
      relativePath: 'my-skill/scripts/run.py',
      platform: 'darwin',
      expected: false,
    },
    {
      name: 'deeper than three segments',
      relativePath: 'my-skill/zhiyuan/sub/SKILL.md',
      platform: 'linux',
      expected: false,
    },
    { name: 'empty path', relativePath: '', platform: 'linux', expected: false },
  ];

  test.each(cases)('$name', ({ relativePath, platform, expected }) => {
    expect(isSkillDefinitionChange(relativePath, platform)).toBe(expected);
  });
});

describe('SkillWatcher recursive watching', () => {
  // Which events notify is covered by the isSkillDefinitionChange table above;
  // these tests only prove the real recursive watcher is wired to it.
  test('notifies when a new skill dir with SKILL.md is created under the root', async () => {
    const root = makeRootDir();
    const watcher = new SkillWatcher(() => [root]);
    const listener = vi.fn();
    watcher.onSkillsChanged(listener);
    watcher.startWatching();

    fs.mkdirSync(path.join(root, 'my-skill'));
    fs.writeFileSync(path.join(root, 'my-skill', 'SKILL.md'), '# my skill');

    await vi.waitFor(
      () => {
        expect(listener).toHaveBeenCalled();
      },
      { timeout: 10_000, interval: 50 },
    );
    watcher.stopWatching();
  });

  test('opens one recursive watcher per existing root and closes it on stop', () => {
    const root = makeRootDir();
    fs.mkdirSync(path.join(root, 'a-skill'));
    fs.writeFileSync(path.join(root, 'a-skill', 'SKILL.md'), '# a');
    const missingRoot = path.join(root, 'does-not-exist');
    const watchSpy = vi.spyOn(fs, 'watch');
    const watcher = new SkillWatcher(() => [root, missingRoot]);

    watcher.startWatching();
    // Node's Linux recursive implementation may call fs.watch again
    // internally for subdirectories, so only the watcher's own call (first)
    // and the absence of a call for the missing root are asserted.
    expect(watchSpy.mock.calls[0][0]).toBe(root);
    expect(watchSpy.mock.calls.some(call => call[0] === missingRoot)).toBe(false);
    expect(watchSpy.mock.calls[0][1]).toEqual({ recursive: true });
    const fsWatcher = watchSpy.mock.results[0].value as fs.FSWatcher;
    const closeSpy = vi.spyOn(fsWatcher, 'close');

    watcher.stopWatching();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    watchSpy.mockRestore();
  });
});
