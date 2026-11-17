import { constants } from 'node:fs';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { seedPythonBaseline } from './baseline';
import { seedWindowsConsoleScripts } from './windowsConsoleScripts';

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, cp: vi.fn(original.cp) };
});

const roots: string[] = [];
afterEach(async () => {
  vi.mocked(cp).mockClear();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'python-baseline-'));
  roots.push(root);
  const sourceRoot = join(root, 'shared');
  const targetRoot = join(root, "workspace with ' spaces");
  const paths = (base: string) => ({
    purelib: join(base, 'site-packages'),
    platlib: join(base, 'site-packages'),
    scripts: join(base, 'bin'),
    abi: 'cpython-314:arm64',
  });
  const source = paths(sourceRoot);
  const target = paths(targetRoot);
  for (const directory of [source.purelib, source.scripts, target.purelib, target.scripts])
    await mkdir(directory, { recursive: true });
  const executableName = process.platform === 'win32' ? 'python.exe' : 'python';
  const sourcePython = join(source.scripts, executableName);
  const targetPython = join(target.scripts, executableName);
  if (process.platform === 'win32') await writeFile(targetPython, 'workspace interpreter');
  const run = vi.fn(async (python: string, args: string[]) => ({
    stdout: JSON.stringify(
      args[2]?.includes('console_scripts') ? [] : python === sourcePython ? source : target,
    ),
    stderr: '',
    exitCode: 0,
  }));
  return { root, source, target, sourcePython, targetPython, run };
}

test('seeds packages once into independent files without changing the bundled baseline', async () => {
  const f = await fixture();
  const packageFile = join(f.source.purelib, 'pandas.py');
  const nativeFile = join(f.source.purelib, 'numpy.so');
  await writeFile(packageFile, 'VALUE = "bundled"');
  await writeFile(nativeFile, 'native extension');
  if (process.platform !== 'win32')
    await symlink(packageFile, join(f.source.purelib, 'package-alias.py'));

  await seedPythonBaseline({ ...f, signal: new AbortController().signal });

  expect(cp).toHaveBeenCalledTimes(1);
  expect(vi.mocked(cp).mock.calls[0][2]).toMatchObject({
    dereference: true,
    mode: constants.COPYFILE_FICLONE,
  });
  const targetFile = join(f.target.purelib, 'pandas.py');
  const [original, copied] = await Promise.all([stat(packageFile), stat(targetFile)]);
  expect(copied.ino).not.toBe(original.ino);
  expect(await readFile(join(f.target.purelib, 'numpy.so'), 'utf8')).toBe('native extension');
  await writeFile(targetFile, 'VALUE = "workspace upgrade"');
  expect(await readFile(packageFile, 'utf8')).toBe('VALUE = "bundled"');
  if (process.platform !== 'win32') {
    await writeFile(join(f.target.purelib, 'package-alias.py'), 'changed alias');
    expect(await readFile(packageFile, 'utf8')).toBe('VALUE = "bundled"');
  }
});

test.skipIf(process.platform === 'win32')(
  'relocates Python console scripts and preserves target interpreter and activation files',
  async () => {
    const f = await fixture();
    await writeFile(join(f.source.scripts, 'python'), 'source interpreter');
    await writeFile(join(f.source.scripts, 'activate'), 'source activation');
    await writeFile(join(f.target.scripts, 'python'), 'target interpreter');
    await writeFile(join(f.target.scripts, 'activate'), 'target activation');
    await writeFile(join(f.source.scripts, 'f2py'), `#!${f.sourcePython}\nprint("entrypoint")\n`, {
      mode: 0o755,
    });
    await writeFile(
      join(f.source.scripts, 'existing-wrapper'),
      `#!/bin/sh\n'''exec' '${f.sourcePython}' "$0" "$@"\n' '''\nprint("wrapped")\n`,
      { mode: 0o755 },
    );

    await seedPythonBaseline({ ...f, signal: new AbortController().signal });

    const script = await readFile(join(f.target.scripts, 'f2py'), 'utf8');
    expect(script).not.toContain(f.sourcePython);
    expect(script).toContain("'\"'\"'");
    expect(script).toContain('print("entrypoint")');
    expect(await readFile(join(f.target.scripts, 'existing-wrapper'), 'utf8')).not.toContain(
      f.sourcePython,
    );
    expect(await readFile(join(f.target.scripts, 'python'), 'utf8')).toBe('target interpreter');
    expect(await readFile(join(f.target.scripts, 'activate'), 'utf8')).toBe('target activation');
    expect((await stat(join(f.target.scripts, 'f2py'))).mode & 0o111).toBe(0o111);
  },
);

test('rejects incompatible binary layouts and shared target directories', async () => {
  const f = await fixture();
  const signal = new AbortController().signal;
  f.target.abi = 'cpython-313:arm64';
  await expect(seedPythonBaseline({ ...f, signal })).rejects.toThrow('interpreter ABI');
  expect(cp).not.toHaveBeenCalled();
  f.target.abi = f.source.abi;
  f.target.purelib = f.source.purelib;
  await expect(seedPythonBaseline({ ...f, signal })).rejects.toThrow('must be independent');
});

test.skipIf(process.platform === 'win32')(
  'executes relocated console scripts through the target path containing spaces and quotes',
  async () => {
    const f = await fixture();
    await writeFile(f.targetPython, '#!/bin/sh\nprintf "%s\\n" "$1"\n', { mode: 0o755 });
    await writeFile(join(f.source.scripts, 'f2py'), `#!${f.sourcePython}\nprint("entrypoint")\n`, {
      mode: 0o755,
    });
    await seedPythonBaseline({ ...f, signal: new AbortController().signal });
    const entrypoint = join(f.target.scripts, 'f2py');
    const result = spawnSync(entrypoint, [], { encoding: 'utf8', timeout: 5000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(entrypoint);
  },
);

test('honors cancellation before probing and during recursive package copying', async () => {
  const f = await fixture();
  const cancelled = new AbortController();
  cancelled.abort(new Error('cancelled before probe'));
  await expect(seedPythonBaseline({ ...f, signal: cancelled.signal })).rejects.toThrow(
    'cancelled before probe',
  );
  expect(f.run).not.toHaveBeenCalled();

  const copying = new AbortController();
  vi.mocked(cp).mockImplementationOnce(async (source, destination, options) => {
    copying.abort(new Error('cancelled during copy'));
    await options?.filter?.(source.toString(), destination.toString());
  });
  await expect(seedPythonBaseline({ ...f, signal: copying.signal })).rejects.toThrow(
    'cancelled during copy',
  );
});

test('generates safe Windows entry points relative to the workspace Python', async () => {
  const f = await fixture();
  const run = vi.fn(async () => ({
    stdout: JSON.stringify([
      { name: 'f2py', distribution: 'numpy' },
      { name: 'F2PY', distribution: 'other-numpy' },
      { name: '../escape', distribution: 'unsafe' },
      { name: 'bad%PATH%', distribution: 'unsafe' },
      { name: 'bad&command', distribution: 'unsafe' },
      { name: 'NUL', distribution: 'unsafe' },
      { name: 'CON.txt', distribution: 'unsafe' },
      { name: 'bad-distribution', distribution: 'bad\";command' },
      { name: 'installed', distribution: 'existing' },
    ]),
    stderr: '',
    exitCode: 0,
  }));
  await writeFile(join(f.target.scripts, 'python.exe'), 'workspace interpreter');
  await writeFile(join(f.target.scripts, 'installed.exe'), 'existing workspace launcher');
  await seedWindowsConsoleScripts({
    targetPython: join(f.target.scripts, 'python.exe'),
    targetScripts: f.target.scripts,
    run,
    signal: new AbortController().signal,
  });
  expect((await readdir(f.target.scripts)).sort()).toEqual([
    'f2py-script.py',
    'f2py.cmd',
    'installed.exe',
    'python.exe',
    'python3.exe',
  ]);
  const cmd = await readFile(join(f.target.scripts, 'f2py.cmd'), 'utf8');
  expect(cmd).toBe('@echo off\r\n"%~dp0python.exe" "%~dp0f2py-script.py" %*\r\n');
  expect(cmd).not.toContain(f.sourcePython);
  expect(cmd).not.toContain(f.targetPython);
  const script = await readFile(join(f.target.scripts, 'f2py-script.py'), 'utf8');
  expect(script).toContain('distribution("numpy").entry_points');
  expect(script).toContain('entry.load()()');
  expect(run).toHaveBeenCalledWith(join(f.target.scripts, 'python.exe'), [
    '-I',
    '-c',
    expect.stringContaining('console_scripts'),
  ]);
});

test('cancels Windows entry point generation without emitting launchers', async () => {
  const f = await fixture();
  const controller = new AbortController();
  await writeFile(join(f.target.scripts, 'python.exe'), 'workspace interpreter');
  const run = vi.fn(async () => {
    controller.abort(new Error('cancelled during metadata probe'));
    return {
      stdout: JSON.stringify([{ name: 'f2py', distribution: 'numpy' }]),
      stderr: '',
      exitCode: 0,
    };
  });
  await expect(
    seedWindowsConsoleScripts({
      targetPython: join(f.target.scripts, 'python.exe'),
      targetScripts: f.target.scripts,
      run,
      signal: controller.signal,
    }),
  ).rejects.toThrow('cancelled during metadata probe');
  expect((await readdir(f.target.scripts)).sort()).toEqual(['python.exe', 'python3.exe']);
});

test('Windows python3 aliases the workspace launcher beside its venv configuration and is never replaced', async () => {
  const f = await fixture();
  const workspace = join(f.root, 'windows-workspace');
  const targetScripts = join(workspace, 'Scripts');
  await mkdir(targetScripts, { recursive: true });
  const config = join(workspace, 'pyvenv.cfg');
  await writeFile(config, 'home = C:\\bundled\\python\n');
  const python = join(targetScripts, 'python.exe');
  const alias = join(targetScripts, 'python3.exe');
  await writeFile(join(f.source.scripts, 'python.exe'), 'shared interpreter');
  await writeFile(python, 'workspace venv launcher');
  const run = vi.fn(async () => ({ stdout: '[]', stderr: '', exitCode: 0 }));
  const options = {
    targetPython: python,
    targetScripts,
    run,
    signal: new AbortController().signal,
  };
  await seedWindowsConsoleScripts(options);
  expect(await readFile(alias, 'utf8')).toBe('workspace venv launcher');
  const [launcherInfo, aliasInfo] = await Promise.all([stat(python), stat(alias)]);
  expect(aliasInfo.ino).not.toBe(launcherInfo.ino);
  await writeFile(alias, 'existing workspace alias');
  await seedWindowsConsoleScripts(options);
  expect(await readFile(alias, 'utf8')).toBe('existing workspace alias');
  expect(await readFile(python, 'utf8')).toBe('workspace venv launcher');
  expect(await readFile(config, 'utf8')).toBe('home = C:\\bundled\\python\n');
});
import { spawnSync } from 'node:child_process';
