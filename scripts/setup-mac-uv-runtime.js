#!/usr/bin/env node
/** Prepare the official uv runtime for packaged macOS and Linux builds. */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(PROJECT_ROOT, 'resources', 'uv-archives');
const UV_VERSION = process.env.ZHIYUAN_UV_VERSION || '0.11.32';

function outputDir(platform) { return path.join(PROJECT_ROOT, 'resources', platform === 'darwin' ? 'uv-mac' : 'uv-linux'); }
function targetAsset(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && arch === 'arm64') return 'uv-aarch64-apple-darwin.tar.gz';
  if (platform === 'darwin' && arch === 'x64') return 'uv-x86_64-apple-darwin.tar.gz';
  if (platform === 'linux' && arch === 'arm64') return 'uv-aarch64-unknown-linux-gnu.tar.gz';
  if (platform === 'linux' && arch === 'x64') return 'uv-x86_64-unknown-linux-gnu.tar.gz';
  return null;
}

function findExecutable(root, name) {
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(candidate);
      else if (entry.isFile() && entry.name === name) return candidate;
    }
  }
  return null;
}

function checkRuntimeHealth(root, arch = process.arch, platform = process.platform) {
  root ||= outputDir(platform);
  const statePath = path.join(root, 'runtime.json');
  let state;
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}
  const missing = [];
  if (!findExecutable(root, 'uv')) missing.push('uv');
  if (!findExecutable(root, 'uvx')) missing.push('uvx');
  if (state?.platform !== platform || state?.arch !== arch || state?.version !== UV_VERSION) missing.push(`runtime.json for ${platform}-${arch}`);
  return { ok: missing.length === 0, missing };
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${url}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const partial = `${destination}.download`;
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial));
    if (!fs.statSync(partial).size) throw new Error('Downloaded uv archive is empty.');
    fs.renameSync(partial, destination);
  } finally { fs.rmSync(partial, { force: true }); }
}

async function ensurePosixUvRuntime(options = {}) {
  const required = Boolean(options.required);
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  if (!['darwin', 'linux'].includes(platform)) return { ok: true, skipped: true, uvPath: null };
  const output = outputDir(platform);
  const asset = targetAsset(platform, arch);
  if (!asset) throw new Error(`Unsupported ${platform} uv architecture: ${arch}`);
  const healthy = checkRuntimeHealth(output, arch, platform);
  if (healthy.ok) return { ok: true, skipped: false, uvPath: findExecutable(output, 'uv') };
  const supplied = process.env.ZHIYUAN_PORTABLE_POSIX_UV_ARCHIVE || process.env.ZHIYUAN_PORTABLE_MAC_UV_ARCHIVE;
  const archive = supplied ? path.resolve(supplied) : path.join(CACHE_DIR, asset);
  if (!supplied && (!fs.existsSync(archive) || !fs.statSync(archive).size)) {
    await download(process.env.ZHIYUAN_PORTABLE_MAC_UV_URL || `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`, archive);
  }
  if (!fs.existsSync(archive) || !fs.statSync(archive).size) throw new Error(`uv archive is unavailable: ${archive}`);
  const temporary = fs.mkdtempSync(path.join(PROJECT_ROOT, 'tmp-mac-uv-'));
  try {
    const result = spawnSync('tar', ['-xzf', archive, '-C', temporary], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Unable to extract uv: ${(result.stderr || result.stdout || '').trim()}`);
    const uv = findExecutable(temporary, 'uv');
    const uvx = findExecutable(temporary, 'uvx');
    if (!uv || !uvx) throw new Error('Official uv archive does not contain uv and uvx.');
    fs.rmSync(output, { recursive: true, force: true });
    fs.mkdirSync(output, { recursive: true });
    fs.copyFileSync(uv, path.join(output, 'uv'));
    fs.copyFileSync(uvx, path.join(output, 'uvx'));
    fs.chmodSync(path.join(output, 'uv'), 0o755);
    fs.chmodSync(path.join(output, 'uvx'), 0o755);
    fs.writeFileSync(path.join(output, 'runtime.json'), `${JSON.stringify({ version: UV_VERSION, platform, arch }, null, 2)}\n`);
    const finalHealth = checkRuntimeHealth(output, arch, platform);
    if (!finalHealth.ok) throw new Error(`Bundled ${platform} uv is unhealthy: ${finalHealth.missing.join(', ')}`);
    return { ok: true, skipped: false, uvPath: path.join(output, 'uv') };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (require.main === module) ensurePosixUvRuntime({ required: process.argv.includes('--required') }).catch(error => { console.error('[setup-posix-uv-runtime] ERROR:', error.message); process.exit(1); });
module.exports = { ensurePosixUvRuntime, ensureMacUvRuntime: options => ensurePosixUvRuntime({ ...options, platform: 'darwin' }), checkRuntimeHealth, targetAsset };
