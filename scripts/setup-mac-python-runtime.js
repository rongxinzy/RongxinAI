#!/usr/bin/env node
/** Install an app-private CPython 3.14.6 with bundled uv on macOS/Linux. */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensurePosixUvRuntime } = require('./setup-mac-uv-runtime.js');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PYTHON_VERSION = process.env.ZHIYUAN_PYTHON_VERSION || '3.14.6';

function outputDir(platform) { return path.join(PROJECT_ROOT, 'resources', platform === 'darwin' ? 'python-mac' : 'python-linux'); }
function pythonPath(root) { return path.join(root, 'bin', 'python3'); }
function checkRuntimeHealth(root, arch = process.arch, platform = process.platform) {
  root ||= outputDir(platform);
  const missing = [];
  const executable = pythonPath(root);
  if (!fs.existsSync(executable)) missing.push('bin/python3');
  let state;
  try { state = JSON.parse(fs.readFileSync(path.join(root, 'runtime.json'), 'utf8')); } catch {}
  if (state?.manager !== 'uv' || state?.python !== PYTHON_VERSION || state?.platform !== platform || state?.arch !== arch) missing.push(`runtime.json for Python ${PYTHON_VERSION}`);
  if (!missing.length) {
    const probe = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 30_000 });
    if (probe.status !== 0 || !`${probe.stdout}${probe.stderr}`.includes(`Python ${PYTHON_VERSION}`)) missing.push(`Python ${PYTHON_VERSION}`);
  }
  return { ok: missing.length === 0, missing };
}

function findPythonRoot(root) {
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    if (fs.existsSync(pythonPath(current))) return current;
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) if (entry.isDirectory()) queue.push(path.join(current, entry.name));
  }
  return null;
}

// python-build-standalone archives contain absolute convenience symlinks. A
// plain recursive copy preserves those source paths, which become dangling as
// soon as the temporary uv install directory is removed. Rebase every link
// that points inside that install root to the copied application runtime.
function rebaseRuntimeSymlinks(root, source) {
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      const stat = fs.lstatSync(target);
      if (stat.isDirectory()) { visit(target); continue; }
      if (!stat.isSymbolicLink()) continue;
      const link = fs.readlinkSync(target);
      if (!path.isAbsolute(link) || !link.startsWith(source + path.sep)) continue;
      const rebased = path.join(root, path.relative(source, link));
      fs.unlinkSync(target);
      fs.symlinkSync(path.relative(path.dirname(target), rebased), target);
    }
  };
  visit(root);
}

async function ensurePosixPythonRuntime(options = {}) {
  const required = Boolean(options.required);
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  if (!['darwin', 'linux'].includes(platform)) return { ok: true, skipped: true, pythonPath: null };
  const output = outputDir(platform);
  const healthy = checkRuntimeHealth(output, arch, platform);
  if (healthy.ok) return { ok: true, skipped: false, pythonPath: pythonPath(output) };
  const uvResult = await ensurePosixUvRuntime({ required: true, arch, platform });
  const temporary = fs.mkdtempSync(path.join(PROJECT_ROOT, `tmp-${platform}-python-`));
  try {
    const installDir = path.join(temporary, 'install');
    const result = spawnSync(uvResult.uvPath, ['python', 'install', PYTHON_VERSION, '--install-dir', installDir, '--no-registry'], { encoding: 'utf8', timeout: 10 * 60_000, env: { ...process.env, UV_CACHE_DIR: path.join(temporary, 'cache'), UV_NO_PROGRESS: '1', UV_NO_MODIFY_PATH: '1' } });
    if (result.status !== 0) throw new Error(`uv could not install Python ${PYTHON_VERSION}: ${(result.stderr || result.stdout || '').trim()}`);
    const source = findPythonRoot(installDir);
    if (!source) throw new Error('uv did not produce a usable macOS Python runtime.');
    fs.rmSync(output, { recursive: true, force: true });
    fs.cpSync(source, output, { recursive: true, dereference: true });
    rebaseRuntimeSymlinks(output, source);
    const python = pythonPath(output);
    // uv-managed standalone CPython deliberately marks its base environment as
    // externally managed (PEP 668). Do not mutate it with ensurepip: Skills use
    // uv to create isolated environments, where pip is available as needed.
    fs.writeFileSync(path.join(output, 'runtime.json'), `${JSON.stringify({ version: 1, manager: 'uv', python: PYTHON_VERSION, platform, arch }, null, 2)}\n`);
    const finalHealth = checkRuntimeHealth(output, arch, platform);
    if (!finalHealth.ok) throw new Error(`Bundled ${platform} Python is unhealthy: ${finalHealth.missing.join(', ')}`);
    return { ok: true, skipped: false, pythonPath: python };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (require.main === module) ensurePosixPythonRuntime({ required: process.argv.includes('--required') }).catch(error => { console.error('[setup-posix-python-runtime] ERROR:', error.message); process.exit(1); });
module.exports = { ensurePosixPythonRuntime, ensureMacPythonRuntime: options => ensurePosixPythonRuntime({ ...options, platform: 'darwin' }), checkRuntimeHealth };
