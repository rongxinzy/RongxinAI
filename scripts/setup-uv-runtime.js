#!/usr/bin/env node
/**
 * Prepare bundled Windows uv runtime under resources/uv-win.
 *
 * Features:
 * - Cross-platform execution for Windows packaging
 * - Optional strict mode via --required
 * - Offline archive support via ZHIYUAN_PORTABLE_UV_ARCHIVE
 * - Mirror URL override via ZHIYUAN_PORTABLE_UV_URL
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const extractZip = require('extract-zip');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'resources', 'uv-win');
const UV_VERSION = process.env.ZHIYUAN_WINDOWS_UV_VERSION || '0.8.4';
const DEFAULT_ARCHIVE_PATH = path.join(PROJECT_ROOT, 'resources', 'uv-win-runtime.zip');

function parseArgs(argv) {
  return {
    required: argv.includes('--required'),
  };
}

function resolveInputPath(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

function isNonEmptyFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function getDirSize(dir) {
  let size = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(full);
    } else {
      size += fs.statSync(full).size;
    }
  }
  return size;
}

function getWindowsUvAsset() {
  const arch = process.env.PROCESSOR_ARCHITECTURE;
  if (arch === 'ARM64') {
    return {
      archive: 'uv-aarch64-pc-windows-msvc.zip',
      url: process.env.ZHIYUAN_PORTABLE_UV_URL
        || `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-aarch64-pc-windows-msvc.zip`,
    };
  }

  return {
    archive: 'uv-x86_64-pc-windows-msvc.zip',
    url: process.env.ZHIYUAN_PORTABLE_UV_URL
      || `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`,
  };
}

function findUvExecutable(baseDir, name) {
  const direct = path.join(baseDir, name);
  if (fs.existsSync(direct)) {
    return direct;
  }

  const queue = [baseDir];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) {
        return fullPath;
      }
    }
  }

  return null;
}

function checkRuntimeHealth(rootDir) {
  const missing = [];
  if (!findUvExecutable(rootDir, 'uv.exe')) {
    missing.push('uv.exe');
  }
  if (!findUvExecutable(rootDir, 'uvx.exe')) {
    missing.push('uvx.exe');
  }
  return { ok: missing.length === 0, missing };
}

async function downloadArchive(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status} ${response.statusText}) for ${url}`);
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const tmpFile = `${destination}.download`;
  try {
    const stream = fs.createWriteStream(tmpFile);
    await pipeline(Readable.fromWeb(response.body), stream);
    if (!isNonEmptyFile(tmpFile)) {
      throw new Error('Downloaded archive is empty.');
    }
    fs.renameSync(tmpFile, destination);
  } catch (error) {
    try {
      fs.rmSync(tmpFile, { force: true });
    } catch {
      // Ignore cleanup errors.
    }
    throw error;
  }
}

async function resolveArchive(required) {
  const envArchive = resolveInputPath(process.env.ZHIYUAN_PORTABLE_UV_ARCHIVE);
  if (envArchive) {
    if (!isNonEmptyFile(envArchive)) {
      throw new Error(`ZHIYUAN_PORTABLE_UV_ARCHIVE points to an invalid file: ${envArchive}`);
    }
    console.log(`[setup-uv-runtime] Using local archive from ZHIYUAN_PORTABLE_UV_ARCHIVE: ${envArchive}`);
    return { archivePath: envArchive, source: 'env-archive' };
  }

  if (isNonEmptyFile(DEFAULT_ARCHIVE_PATH)) {
    console.log(`[setup-uv-runtime] Using cached archive: ${DEFAULT_ARCHIVE_PATH}`);
    return { archivePath: DEFAULT_ARCHIVE_PATH, source: 'cache' };
  }

  const asset = getWindowsUvAsset();
  try {
    console.log(`[setup-uv-runtime] Downloading runtime from: ${asset.url}`);
    await downloadArchive(asset.url, DEFAULT_ARCHIVE_PATH);
    const fileSizeMB = (fs.statSync(DEFAULT_ARCHIVE_PATH).size / 1024 / 1024).toFixed(1);
    console.log(`[setup-uv-runtime] Downloaded archive (${fileSizeMB} MB): ${DEFAULT_ARCHIVE_PATH}`);
    return { archivePath: DEFAULT_ARCHIVE_PATH, source: 'download' };
  } catch (error) {
    if (required) {
      throw new Error(
        'Unable to obtain portable uv runtime archive. '
        + 'Set ZHIYUAN_PORTABLE_UV_ARCHIVE to a local offline package or '
        + 'set ZHIYUAN_PORTABLE_UV_URL to a reachable mirror. '
        + `Original error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    console.warn(
      '[setup-uv-runtime] Runtime archive is not available; skip because --required is not set. '
      + `Reason: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

function copyRuntimeTree(sourceRoot, destRoot) {
  if (fs.existsSync(destRoot)) {
    fs.rmSync(destRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(destRoot, { recursive: true });
  fs.cpSync(sourceRoot, destRoot, {
    recursive: true,
    dereference: true,
    force: true,
    errorOnExist: false,
  });
}

async function extractArchiveToRuntime(archivePath) {
  const tempRoot = fs.mkdtempSync(path.join(PROJECT_ROOT, 'tmp-uv-runtime-'));
  try {
    await extractZip(archivePath, { dir: tempRoot });
    const uvExe = findUvExecutable(tempRoot, 'uv.exe');
    const uvxExe = findUvExecutable(tempRoot, 'uvx.exe');
    if (!uvExe || !uvxExe) {
      throw new Error('Could not locate uv.exe and uvx.exe after extraction.');
    }

    copyRuntimeTree(path.dirname(uvExe), OUTPUT_DIR);
    const health = checkRuntimeHealth(OUTPUT_DIR);
    if (!health.ok) {
      throw new Error(`Runtime health check failed; missing: ${health.missing.join(', ')}`);
    }
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }
}

function findPortableUvExecutables(baseDir = OUTPUT_DIR) {
  return {
    uv: findUvExecutable(baseDir, 'uv.exe'),
    uvx: findUvExecutable(baseDir, 'uvx.exe'),
  };
}

async function ensurePortableUvRuntime(options = {}) {
  const required = Boolean(options.required);
  const shouldRun = process.platform === 'win32'
    || required
    || process.env.ZHIYUAN_SETUP_UV_RUNTIME_FORCE === '1';

  if (!shouldRun) {
    console.log('[setup-uv-runtime] Skip on non-Windows host (pass --required to force cross-platform preparation).');
    return { ok: true, skipped: true, uvPath: null, uvxPath: null };
  }

  const existingHealth = checkRuntimeHealth(OUTPUT_DIR);
  if (existingHealth.ok) {
    const executables = findPortableUvExecutables(OUTPUT_DIR);
    console.log(`[setup-uv-runtime] Runtime already prepared: ${executables.uv || OUTPUT_DIR}`);
    return { ok: true, skipped: false, uvPath: executables.uv, uvxPath: executables.uvx };
  }

  const archive = await resolveArchive(required);
  if (!archive) {
    return { ok: true, skipped: true, uvPath: null, uvxPath: null };
  }

  console.log(`[setup-uv-runtime] Extracting runtime archive (${archive.source})...`);
  await extractArchiveToRuntime(archive.archivePath);

  const executables = findPortableUvExecutables(OUTPUT_DIR);
  const finalHealth = checkRuntimeHealth(OUTPUT_DIR);
  if (!finalHealth.ok) {
    throw new Error(
      'Portable uv runtime is missing required executables after preparation: '
      + finalHealth.missing.join(', ')
    );
  }

  const finalSize = getDirSize(OUTPUT_DIR);
  console.log(`[setup-uv-runtime] Portable uv runtime ready: ${executables.uv || OUTPUT_DIR}`);
  console.log(`[setup-uv-runtime] Total size: ~${(finalSize / 1024 / 1024).toFixed(1)} MB`);
  return { ok: true, skipped: false, uvPath: executables.uv, uvxPath: executables.uvx };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensurePortableUvRuntime({ required: args.required });
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[setup-uv-runtime] ERROR:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  ensurePortableUvRuntime,
  findPortableUvExecutables,
  checkRuntimeHealth,
};
