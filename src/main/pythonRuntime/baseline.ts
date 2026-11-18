import { constants } from 'node:fs';
import { cp, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { seedWindowsConsoleScripts } from './windowsConsoleScripts';

type PythonLayout = { purelib: string; platlib: string; scripts: string; abi: string };
type BaselineRun = (
  python: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

const LAYOUT_SCRIPT = [
  'import json,sys,sysconfig',
  'paths = {key: sysconfig.get_path(key) for key in ("purelib", "platlib", "scripts")}',
  'paths["abi"] = ":".join((sys.implementation.cache_tag or "", sysconfig.get_config_var("SOABI") or "", sysconfig.get_platform()))',
  'print(json.dumps(paths))',
].join('; ');

async function layout(python: string, run: BaselineRun): Promise<PythonLayout> {
  const result = await run(python, ['-I', '-c', LAYOUT_SCRIPT]);
  if (result.exitCode !== 0)
    throw new Error(`Unable to inspect the Python baseline: ${result.stderr}`);
  const parsed: unknown = JSON.parse(result.stdout);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid Python baseline layout.');
  const value = parsed as Record<string, unknown>;
  for (const key of ['purelib', 'platlib', 'scripts'] as const) {
    if (typeof value[key] !== 'string' || !isAbsolute(value[key]))
      throw new Error('Invalid Python baseline path.');
  }
  if (typeof value.abi !== 'string' || !value.abi) throw new Error('Invalid Python baseline ABI.');
  return value as PythonLayout;
}

function overlaps(first: string, second: string): boolean {
  const fromFirst = relative(first, second);
  const fromSecond = relative(second, first);
  const inside = (value: string) =>
    value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value));
  return inside(fromFirst) || inside(fromSecond);
}

/** Recreate Python console scripts without retaining the bundled venv's path. */
async function seedConsoleScripts(
  source: string,
  target: string,
  targetPython: string,
  run: BaselineRun,
  signal: AbortSignal,
): Promise<void> {
  if (process.platform === 'win32') {
    await seedWindowsConsoleScripts({
      sourceScripts: source,
      targetPython,
      targetScripts: target,
      run,
      signal,
    });
    return;
  }
  const quotedPython = `'${targetPython.replace(/'/g, "'\"'\"'")}'`;
  const shebang = `#!/bin/sh\n'''exec' ${quotedPython} "$0" "$@"\n' '''\n`;
  for (const entry of await readdir(source, { withFileTypes: true })) {
    signal.throwIfAborted();
    if (!entry.isFile() || /^python(?:w|\d[\d.]*)?$|^(?:de)?activate(?:[._-]|$)/i.test(entry.name))
      continue;
    const sourcePath = join(source, entry.name);
    const info = await stat(sourcePath);
    if (info.size > 1024 * 1024) continue;
    const data = await readFile(sourcePath);
    if (data.includes(0)) continue;
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      continue;
    }
    const preamble = text.match(
      /^#![^\r\n]*\bpython[\d.]*[^\r\n]*\r?\n|^#!\/bin\/sh\r?\n'''exec' [^\r\n]*\r?\n' '''\r?\n/,
    );
    if (!preamble) continue;
    signal.throwIfAborted();
    try {
      await writeFile(join(target, entry.name), shebang + text.slice(preamble[0].length), {
        flag: 'wx',
        mode: info.mode & 0o777,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

/** Runs only inside the Python Runner, never on Electron's main thread. */
export async function seedPythonBaseline(options: {
  sourcePython: string;
  targetPython: string;
  run: BaselineRun;
  signal: AbortSignal;
}): Promise<void> {
  const { sourcePython, targetPython, run, signal } = options;
  signal.throwIfAborted();
  const source = await layout(sourcePython, run);
  signal.throwIfAborted();
  const target = await layout(targetPython, run);
  signal.throwIfAborted();
  if (source.abi !== target.abi)
    throw new Error('The bundled Python baseline does not match the workspace interpreter ABI.');
  const copies = new Set<string>();
  for (const key of ['purelib', 'platlib'] as const) {
    signal.throwIfAborted();
    await mkdir(target[key], { recursive: true });
    const sourcePath = await realpath(source[key]);
    const targetPath = await realpath(target[key]);
    if (overlaps(sourcePath, targetPath))
      throw new Error('Python baseline and workspace package directories must be independent.');
    const copyKey = `${sourcePath}\0${targetPath}`;
    if (copies.has(copyKey)) continue;
    copies.add(copyKey);
    await cp(sourcePath, targetPath, {
      recursive: true,
      dereference: true,
      // FICLONE attempts a copy-on-write clone and falls back to ordinary copying
      // when unsupported. Both create independent files, unlike hard links.
      mode: constants.COPYFILE_FICLONE,
      filter: () => {
        signal.throwIfAborted();
        return true;
      },
    });
  }
  signal.throwIfAborted();
  await seedConsoleScripts(source.scripts, target.scripts, targetPython, run, signal);
  signal.throwIfAborted();
}
