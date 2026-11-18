import { constants } from 'node:fs';
import { access, copyFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { WINDOWS_WHEEL_EXECUTABLES } from './windowsWheelExecutables';

const CONSOLE_METADATA_SCRIPT =
  WINDOWS_WHEEL_EXECUTABLES +
  [
    'import json',
    'entries = [{"name": ep.name, "distribution": dist.metadata["Name"]} for dist in distributions for ep in dist.entry_points if ep.group == "console_scripts"]',
    'print(json.dumps(sorted(entries, key=lambda entry: (entry["name"].lower(), entry["distribution"].lower()))))',
  ].join('; ');
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Preserve wheel executables and make launchers point to the target interpreter. */
export async function seedWindowsConsoleScripts(options: {
  sourceScripts: string;
  targetPython: string;
  targetScripts: string;
  run: (
    python: string,
    args: string[],
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  signal: AbortSignal;
}): Promise<void> {
  const { sourceScripts, targetPython, targetScripts, run, signal } = options;
  signal.throwIfAborted();
  try {
    // Keep the alias beside the workspace launcher so Windows resolves the same
    // parent pyvenv.cfg. Never alias the bundled/shared interpreter into PATH.
    await copyFile(
      targetPython,
      join(targetScripts, 'python3.exe'),
      constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  signal.throwIfAborted();
  const result = await run(targetPython, [
    '-I',
    '-c',
    CONSOLE_METADATA_SCRIPT,
    sourceScripts,
    targetScripts,
  ]);
  if (result.exitCode !== 0)
    throw new Error(`Unable to inspect Python console entry points: ${result.stderr}`);
  const entries: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(entries) || entries.length > 4096)
    throw new Error('Invalid Python console entry point metadata.');
  const seen = new Set<string>();
  for (const entry of entries) {
    signal.throwIfAborted();
    if (!entry || typeof entry !== 'object')
      throw new Error('Invalid Python console entry point metadata.');
    const { name, distribution } = entry as Record<string, unknown>;
    if (
      typeof name !== 'string' ||
      typeof distribution !== 'string' ||
      !SAFE_NAME.test(name) ||
      !SAFE_NAME.test(distribution) ||
      WINDOWS_DEVICE_NAME.test(name)
    )
      continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const scriptName = `${name}-script.py`;
    const targetCmd = join(targetScripts, `${name}.cmd`);
    const targetScript = join(targetScripts, scriptName);
    if (
      await Promise.all(
        [
          targetCmd,
          targetScript,
          join(targetScripts, `${name}.exe`),
          join(targetScripts, `${name}.bat`),
        ].map(exists),
      ).then(values => values.some(Boolean))
    )
      continue;
    const script = [
      'import sys',
      'from importlib.metadata import distribution',
      'if __name__ == "__main__":',
      `    entry = next(ep for ep in distribution(${JSON.stringify(distribution)}).entry_points if ep.group == "console_scripts" and ep.name == ${JSON.stringify(name)})`,
      '    sys.argv[0] = sys.argv[0].removesuffix("-script.py")',
      '    sys.exit(entry.load()())',
      '',
    ].join('\n');
    await writeFile(targetScript, script, { flag: 'wx' });
    signal.throwIfAborted();
    const cmd = `@echo off\r\n"%~dp0${basename(targetPython)}" "%~dp0${scriptName}" %*\r\n`;
    await writeFile(targetCmd, cmd, { flag: 'wx' });
  }
}
