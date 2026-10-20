'use strict';

const fs = require('node:fs');
const path = require('node:path');

// CPython's Windows venv redirector reads an absolute home from pyvenv.cfg.
// uv --relocatable relocates entrypoints, not that interpreter dependency.
// Keep the existing Scripts/python.exe contract, but make Scripts a complete
// standalone interpreter. Wheels stay single-copy; only the base stdlib/DLLs
// accompany them. No custom launcher, system Python or install-time rewrite.
function finalizeWindowsSkillPython(sharedRoot, basePythonPath, platform) {
  if (platform !== 'win32') return;
  const config = path.join(sharedRoot, 'pyvenv.cfg');
  if (!fs.existsSync(config)) return;
  const baseRoot = path.dirname(basePythonPath);
  const scripts = path.join(sharedRoot, 'Scripts');
  const library = path.join(sharedRoot, 'Lib');
  for (const required of [basePythonPath, path.join(baseRoot, 'Lib', 'os.py'), library]) {
    if (!fs.existsSync(required)) throw new Error(`Missing standalone Python input: ${required}`);
  }
  const baseLibrary = path.join(baseRoot, 'Lib');
  fs.cpSync(baseLibrary, library, {
    recursive: true,
    dereference: true,
    filter: source => path.relative(baseLibrary, source).split(path.sep)[0] !== 'site-packages',
  });
  for (const entry of fs.readdirSync(baseRoot)) {
    if (['Lib', 'Scripts', 'runtime.json', 'pyvenv.cfg'].includes(entry)) continue;
    fs.cpSync(path.join(baseRoot, entry), path.join(scripts, entry), {
      recursive: true,
      dereference: true,
    });
  }
  fs.renameSync(library, path.join(scripts, 'Lib'));
  fs.copyFileSync(path.join(scripts, 'python.exe'), path.join(scripts, 'python3.exe'));
  fs.rmSync(config);
}

module.exports = { finalizeWindowsSkillPython };
