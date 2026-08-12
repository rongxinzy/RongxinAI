#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const inputPath = path.resolve(projectRoot, process.argv[2] || 'public/zhiyuan-logo-light-1600.png');
const outputDir = path.resolve(projectRoot, 'resources/tray');

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    const detail = stderr || stdout || `exit code ${result.status}`;
    throw new Error(`${cmd} ${args.join(' ')} failed: ${detail}`);
  }
}

function hasCommand(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'ignore' });
  return result.status === 0;
}

function ensureImageMagick() {
  if (hasCommand('magick', ['-version'])) return 'magick';
  if (hasCommand('convert', ['-version'])) return 'convert';
  throw new Error('ImageMagick is required. Please install `magick` or `convert`.');
}

function ensureInputExists() {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input logo not found: ${inputPath}`);
  }
}

function ensureOutputDir() {
  fs.mkdirSync(outputDir, { recursive: true });
}

function main() {
  ensureInputExists();
  ensureOutputDir();
  const magick = ensureImageMagick();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tray-icons-'));

  const win16 = path.join(tmpDir, 'tray-16.png');
  const win32 = path.join(tmpDir, 'tray-32.png');
  const win48 = path.join(tmpDir, 'tray-48.png');

  const linuxPng = path.join(outputDir, 'tray-icon.png');
  const winIco = path.join(outputDir, 'tray-icon.ico');
  const macTemplate = path.join(outputDir, 'trayIconTemplate.png');
  const macTemplate2x = path.join(outputDir, 'trayIconTemplate@2x.png');
  const macColor = path.join(outputDir, 'tray-icon-mac.png');
  const macColor2x = path.join(outputDir, 'tray-icon-mac@2x.png');
  const macColorRaw = path.join(tmpDir, 'tray-icon-mac-raw.png');
  const macColor2xRaw = path.join(tmpDir, 'tray-icon-mac@2x-raw.png');

  run(magick, [inputPath, '-resize', '48x48', linuxPng]);

  run(magick, [inputPath, '-resize', '16x16', win16]);
  run(magick, [inputPath, '-resize', '32x32', win32]);
  run(magick, [inputPath, '-resize', '48x48', win48]);
  run(magick, [win16, win32, win48, winIco]);

  // macOS template images: convert the white glyph to opaque pixels while
  // forcing the red background fully transparent, then center the glyph with
  // a small padding to avoid menu bar clipping.
  run(magick, [
    inputPath,
    '-resize',
    '18x18',
    '-colorspace',
    'Gray',
    '-threshold',
    '70%',
    '-alpha',
    'copy',
    '-channel',
    'RGB',
    '-fill',
    'black',
    '-colorize',
    '100',
    '-trim',
    '+repage',
    '-background',
    'none',
    '-gravity',
    'center',
    '-extent',
    '18x18',
    macTemplate,
  ]);

  run(magick, [
    inputPath,
    '-resize',
    '36x36',
    '-colorspace',
    'Gray',
    '-threshold',
    '70%',
    '-alpha',
    'copy',
    '-channel',
    'RGB',
    '-fill',
    'black',
    '-colorize',
    '100',
    '-trim',
    '+repage',
    '-background',
    'none',
    '-gravity',
    'center',
    '-extent',
    '36x36',
    macTemplate2x,
  ]);

  // macOS color tray icons: preserve original brand colors.
  run(magick, [
    inputPath,
    '-trim',
    '+repage',
    '-resize',
    '16x16',
    '-modulate',
    '108,118,100',
    '-sigmoidal-contrast',
    '4,50%',
    '-background',
    'none',
    '-gravity',
    'center',
    '-extent',
    '18x18',
    macColorRaw,
  ]);

  run(magick, [
    inputPath,
    '-trim',
    '+repage',
    '-resize',
    '32x32',
    '-modulate',
    '108,118,100',
    '-sigmoidal-contrast',
    '4,50%',
    '-background',
    'none',
    '-gravity',
    'center',
    '-extent',
    '36x36',
    macColor2xRaw,
  ]);

  run(magick, [
    macColorRaw,
    '-alpha',
    'on',
    '-colorspace',
    'sRGB',
    '-type',
    'TrueColorAlpha',
    '-strip',
    '-define',
    'png:color-type=6',
    macColor,
  ]);

  run(magick, [
    macColor2xRaw,
    '-alpha',
    'on',
    '-colorspace',
    'sRGB',
    '-type',
    'TrueColorAlpha',
    '-strip',
    '-define',
    'png:color-type=6',
    macColor2x,
  ]);

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`Generated tray icons from ${inputPath} -> ${outputDir}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
