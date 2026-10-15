#!/usr/bin/env node

/*
 * Builds the WebView2 installer shell and stages the UI next to it.
 *
 *   node scripts/installer-shell/build-shell.cjs [--run]
 *
 * Requires a .NET SDK. Development checkout uses the portable SDK at
 * .cache/dotnet (gitignored); set ZHIYUAN_DOTNET to override. [--run] starts
 * the shell pointed at the staged UI.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const appDir = path.join(projectRoot, 'scripts', 'installer-shell', 'app');
const previewDir = path.join(projectRoot, 'scripts', 'installer-shell', 'preview');
const outDir = path.join(projectRoot, 'scripts', 'installer-shell', 'out');
const localDotnet = path.join(projectRoot, '.cache', 'dotnet', 'dotnet.exe');
const dotnet = process.env.ZHIYUAN_DOTNET || (fs.existsSync(localDotnet) ? localDotnet : 'dotnet');

function fail(message) {
  console.error(`[installer-shell] ${message}`);
  process.exitCode = 1;
}

const probe = spawnSync(dotnet, ['--version'], { encoding: 'utf8' });
if (probe.status !== 0) {
  fail(`.NET SDK not found at ${dotnet}: ${probe.error?.message || probe.stderr || ''}`);
  return;
}

const publish = spawnSync(
  dotnet,
  [
    'publish',
    path.join(appDir, 'ZhiYuan.Setup.Shell.csproj'),
    '-c',
    'Release',
    '-o',
    outDir,
    '-r',
    'win-x64',
    '--self-contained',
    'true',
    '-p:PublishSingleFile=true',
    '-p:IncludeNativeLibrariesForSelfExtract=true',
    '-p:EnableCompressionInSingleFile=true',
  ],
  { cwd: appDir, encoding: 'utf8' },
);
process.stdout.write(publish.stdout || '');
process.stderr.write(publish.stderr || '');
if (publish.status !== 0) {
  fail(`dotnet publish exited with code ${publish.status}`);
  return;
}

// Stage the UI and the brand assets it references.
const uiDir = path.join(outDir, 'ui');
const assetDir = path.join(uiDir, 'assets');
fs.rmSync(uiDir, { recursive: true, force: true });
fs.mkdirSync(assetDir, { recursive: true });
fs.copyFileSync(path.join(previewDir, 'index.html'), path.join(uiDir, 'index.html'));
fs.copyFileSync(
  path.join(projectRoot, 'public', 'zhiyuan-logo-light-1600.png'),
  path.join(assetDir, 'zhiyuan-logo-light-1600.png'),
);
fs.copyFileSync(
  path.join(projectRoot, 'build', 'icons', 'png', '256x256.png'),
  path.join(assetDir, '256x256.png'),
);
console.log(`[installer-shell] staged UI at ${uiDir}`);

const exe = path.join(outDir, 'ZhiYuanSetupShell.exe');
fs.copyFileSync(exe, path.join(outDir, 'ZhiYuanUninstall.exe'));
if (process.argv.includes('--run')) {
  const child = spawnSync('cmd.exe', ['/c', 'start', '', exe], { cwd: outDir, stdio: 'ignore' });
  if (child.error) {
    fail(`failed to start shell: ${child.error.message}`);
    return;
  }
  console.log(`[installer-shell] started ${exe}`);
}
