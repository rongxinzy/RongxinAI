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
  vi.restoreAllMocks();
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
  test('keeps watches for unchanged roots and closes only removed roots', () => {
    const first = makeRootDir();
    const second = makeRootDir();
    let roots = [first];
    const watchSpy = vi.spyOn(fs, 'watch');
    const watcher = new SkillWatcher(() => roots);
    try {
      watcher.startWatching();
      const closeFirst = vi.spyOn(watchSpy.mock.results[0].value as fs.FSWatcher, 'close');
      roots = [first, second];
      watcher.startWatching();
      expect(closeFirst).not.toHaveBeenCalled();
      expect(watchSpy.mock.calls.filter(([root]) => root === first)).toHaveLength(1);
      expect(watchSpy.mock.calls.filter(([root]) => root === second)).toHaveLength(1);
      roots = [second];
      watcher.startWatching();
      expect(closeFirst).toHaveBeenCalledOnce();
      expect(watchSpy.mock.calls.filter(([root]) => root === second)).toHaveLength(1);
    } finally {
      watcher.stopWatching();
    }
  });

  // Which events notify is covered by the isSkillDefinitionChange table above;
  // these tests only prove the real recursive watcher is wired to it.
  test('notifies when a new skill dir with SKILL.md is created under the root', async () => {
    const root = makeRootDir();
    const watch = vi.spyOn(fs, 'watch');
    const watcher = new SkillWatcher(() => [root]);
    const listener = vi.fn();
    watcher.onSkillsChanged(listener);
    watcher.startWatching();

    try {
      // Native recursive registration can miss events before it reports its first change.
      const ready = vi.fn();
      const probe = '.watch-probe';
      (watch.mock.results[0].value as fs.FSWatcher).on('change', (_event, name) => {
        if (name === probe) ready();
      });
      await vi.waitFor(
        () => {
          fs.writeFileSync(path.join(root, probe), String(Date.now()));
          expect(ready).toHaveBeenCalled();
        },
        { timeout: 10_000, interval: 50 },
      );
      fs.mkdirSync(path.join(root, 'my-skill'));
      fs.writeFileSync(path.join(root, 'my-skill', 'SKILL.md'), '# my skill');
      await vi.waitFor(() => expect(listener).toHaveBeenCalled(), {
        timeout: 10_000,
        interval: 50,
      });
    } finally {
      watcher.stopWatching();
    }
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
    const missing = watchSpy.mock.calls.findIndex(call => call[0] === missingRoot);
    expect(watchSpy.mock.results[missing]?.type).toBe('throw');
    expect(watchSpy.mock.calls[0][1]).toEqual({ recursive: true });
    const fsWatcher = watchSpy.mock.results[0].value as fs.FSWatcher;
    const closeSpy = vi.spyOn(fsWatcher, 'close');

    watcher.stopWatching();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    watchSpy.mockRestore();
  });

  test('reclaims Windows tombstones asynchronously and preserves Skill definitions and unrelated files', async () => {
    const root = makeRootDir();
    const tombstone = path.join(root, 'removed.deleted.123');
    const installed = path.join(root, 'active.deleted.123');
    const ordinaryFile = path.join(root, 'note.deleted.123');
    fs.mkdirSync(path.join(tombstone, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(tombstone, 'nested', 'output'), 'stale');
    fs.mkdirSync(installed);
    fs.writeFileSync(path.join(installed, 'SKILL.md'), '# Active skill');
    fs.writeFileSync(ordinaryFile, 'keep');
    const watcher = new SkillWatcher(() => [root], 'win32');

    try {
      watcher.startWatching();
      expect(fs.existsSync(tombstone)).toBe(true);
      await vi.waitFor(() => expect(fs.existsSync(tombstone)).toBe(false));
      expect(fs.existsSync(installed)).toBe(true);
      expect(fs.readFileSync(ordinaryFile, 'utf8')).toBe('keep');
    } finally {
      watcher.stopWatching();
    }
  });

  test('only sweeps the latest roots after rebinding and stops after the in-flight deletion on shutdown', async () => {
    const first = makeRootDir();
    const superseded = makeRootDir();
    const last = makeRootDir();
    for (const root of [first, superseded, last]) {
      fs.mkdirSync(path.join(root, 'undone.deleted.1'));
    }
    const removing = Promise.withResolvers<void>();
    const deleted = Promise.withResolvers<void>();
    const reading = Promise.withResolvers<void>();
    const opened = Promise.withResolvers<void>();
    const rm = fs.promises.rm;
    const opendir = fs.promises.opendir;
    const remove = vi.spyOn(fs.promises, 'rm').mockImplementationOnce(async (...args) => {
      removing.resolve();
      await deleted.promise;
      await rm(...args);
    });
    const scan = vi.spyOn(fs.promises, 'opendir').mockImplementation(async (root, options) => {
      if (root === last) {
        reading.resolve();
        await opened.promise;
      }
      return opendir(root, options);
    });
    let roots = [first];
    const watcher = new SkillWatcher(() => roots, 'win32');
    const notify = vi.fn();
    watcher.onSkillsChanged(notify);

    try {
      watcher.startWatching();
      await removing.promise;
      roots = [superseded];
      watcher.startWatching();
      roots = [last];
      watcher.startWatching();
      expect(scan.mock.calls.map(([root]) => root)).toEqual([first]);
      deleted.resolve();
      await reading.promise;
      expect(scan.mock.calls.map(([root]) => root)).toEqual([first, last]);
      const shutdown = watcher.shutdown();
      watcher.handleWorkingDirectoryChange();
      opened.resolve();
      await shutdown;
      expect(remove).toHaveBeenCalledOnce();
      expect(notify).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(superseded, 'undone.deleted.1'))).toBe(true);
      expect(fs.existsSync(path.join(last, 'undone.deleted.1'))).toBe(true);
    } finally {
      deleted.resolve();
      opened.resolve();
      await watcher.shutdown();
    }
  });
});
