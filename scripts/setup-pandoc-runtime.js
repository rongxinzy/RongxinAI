#!/usr/bin/env node
/**
 * Prepare a private Pandoc runtime for packaged Windows and macOS builds.
 * The document Skill must never assume that an end user installed Pandoc.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const extractZip = require('extract-zip');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PANDOC_VERSION = process.env.ZHIYUAN_PANDOC_VERSION || '3.9.0.2';
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'resources', 'pandoc');
const CACHE_DIR = path.join(PROJECT_ROOT, 'resources', 'pandoc-archives');
const STATE_FILE = 'runtime.json';

function parseArgs(argv) {
  return { required: argv.includes('--required') };
}

function resolveInputPath(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}

function targetAsset(platform = process.platform, arch = process.arch) {
  if (platform === 'win32' && arch === 'x64') return `pandoc-${PANDOC_VERSION}-windows-x86_64.zip`;
  if (platform === 'darwin' && arch === 'arm64') return `pandoc-${PANDOC_VERSION}-arm64-macOS.zip`;
  if (platform === 'darwin' && arch === 'x64') return `pandoc-${PANDOC_VERSION}-x86_64-macOS.zip`;
  return null;
}

function expectedExecutable(platform = process.platform) {
  return platform === 'win32' ? 'pandoc.exe' : 'pandoc';
}

function findExecutable(rootDir, name) {
  const queue = [rootDir];
  while (queue.length) {
    const current = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(candidate);
      else if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return candidate;
    }
  }
  return null;
}

function checkRuntimeHealth(rootDir = OUTPUT_DIR, platform = process.platform, arch = process.arch) {
  const executable = findExecutable(rootDir, expectedExecutable(platform));
  let state = null;
  try {
    state = JSON.parse(fs.readFileSync(path.join(rootDir, STATE_FILE), 'utf8'));
  } catch {}
  const correctTarget = state?.platform === platform && state?.arch === arch;
  const missing = [];
  if (!executable) missing.push(expectedExecutable(platform));
  if (!correctTarget) missing.push(`${STATE_FILE} for ${platform}-${arch}`);
  return { ok: missing.length === 0, executable, missing };
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body)
    throw new Error(`Download failed (${response.status} ${response.statusText}) for ${url}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.download`;
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));
    if (!fs.statSync(temporary).size) throw new Error('Downloaded Pandoc archive is empty.');
    fs.renameSync(temporary, destination);
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {}
  }
}

async function resolveArchive(required, platform = process.platform, arch = process.arch) {
  const supplied = resolveInputPath(process.env.ZHIYUAN_PANDOC_ARCHIVE);
  if (supplied) {
    if (!fs.existsSync(supplied) || !fs.statSync(supplied).size)
      throw new Error(`ZHIYUAN_PANDOC_ARCHIVE points to an invalid file: ${supplied}`);
    return supplied;
  }
  const asset = targetAsset(platform, arch);
  if (!asset) {
    if (required) throw new Error(`No bundled Pandoc target for ${platform}-${arch}.`);
    return null;
  }
  const cachePath = path.join(CACHE_DIR, asset);
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size) return cachePath;
  const url = process.env.ZHIYUAN_PANDOC_URL || `https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/${asset}`;
  try {
    console.log(`[setup-pandoc-runtime] Downloading ${url}`);
    await download(url, cachePath);
    return cachePath;
  } catch (error) {
    if (required) throw error;
    console.warn(`[setup-pandoc-runtime] Pandoc runtime unavailable: ${error.message}`);
    return null;
  }
}

async function ensurePortablePandocRuntime(options = {}) {
  const required = Boolean(options.required);
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  if (!['win32', 'darwin'].includes(platform)) return { ok: true, skipped: true, executable: null };
  const existing = checkRuntimeHealth(OUTPUT_DIR, platform, arch);
  if (existing.ok) return { ok: true, skipped: false, executable: existing.executable };
  const archive = await resolveArchive(required, platform, arch);
  if (!archive) return { ok: true, skipped: true, executable: null };
  const temporary = fs.mkdtempSync(path.join(PROJECT_ROOT, 'tmp-pandoc-runtime-'));
  try {
    await extractZip(archive, { dir: temporary });
    const executable = findExecutable(temporary, expectedExecutable(platform));
    if (!executable) throw new Error(`Pandoc archive does not contain ${expectedExecutable(platform)}.`);
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.cpSync(path.dirname(executable), OUTPUT_DIR, { recursive: true });
    if (platform !== 'win32') fs.chmodSync(path.join(OUTPUT_DIR, expectedExecutable(platform)), 0o755);
    fs.writeFileSync(
      path.join(OUTPUT_DIR, STATE_FILE),
      `${JSON.stringify({ version: 1, platform, arch, pandocVersion: PANDOC_VERSION }, null, 2)}\n`,
    );
    const health = checkRuntimeHealth(OUTPUT_DIR, platform, arch);
    if (!health.ok) throw new Error(`Pandoc runtime health check failed: ${health.missing.join(', ')}`);
    console.log(`[setup-pandoc-runtime] Bundled Pandoc ready: ${health.executable}`);
    return { ok: true, skipped: false, executable: health.executable };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) {
  ensurePortablePandocRuntime(parseArgs(process.argv.slice(2))).catch(error => {
    console.error('[setup-pandoc-runtime] ERROR:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = { ensurePortablePandocRuntime, checkRuntimeHealth, targetAsset };
