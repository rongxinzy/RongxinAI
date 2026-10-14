#!/usr/bin/env node

/*
 * Milestone B packer: assembles the payload contract, zips it, and appends it
 * to the WebView2 shell exe, producing the single-file installer.
 *
 *   node scripts/installer-shell/pack-setup.cjs \
 *     --app-dir <应用文件目录> --components-dir <build-tar/windows-components> \
 *     [--out <输出.exe>] [--payload-zip <existing.zip>]
 *
 * --payload-zip skips assembly entirely and appends the given zip (SFX smoke
 * tests on machines without real build artifacts).
 *
 * Container format (appended to the shell exe):
 *   [shell exe bytes][payload.zip][8B little-endian zip size][4B magic "ZYP1"]
 */
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const shellExe = path.join(
  projectRoot,
  'scripts',
  'installer-shell',
  'out',
  'ZhiYuanSetupShell.exe',
);
const sevenZip = path.join(projectRoot, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const packageVersion = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
).version;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

function fail(message) {
  console.error(`[pack-setup] ${message}`);
  process.exit(1);
}

const appDir = argValue('--app-dir');
const componentsDir = argValue('--components-dir');
const payloadZipArg = argValue('--payload-zip');
const outArg = argValue('--out');

if (!fs.existsSync(shellExe)) {
  fail(`shell exe not found at ${shellExe} — run build-shell.cjs first`);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

let payloadZip;
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'zy-pack-'));

try {
  if (payloadZipArg) {
    payloadZip = path.resolve(payloadZipArg);
    if (!fs.existsSync(payloadZip)) fail(`--payload-zip not found: ${payloadZip}`);
    console.log(`[pack-setup] using existing payload zip ${payloadZip}`);
  } else {
    if (!appDir || !fs.existsSync(appDir)) {
      fail('--app-dir <应用文件目录> is required (real build output) and must exist');
    }
    if (!componentsDir || !fs.existsSync(componentsDir)) {
      fail('--components-dir <build-tar/windows-components> is required and must exist');
    }
    const payloadDir = path.join(staging, 'payload');
    for (const dir of ['tools', 'components', 'scripts']) {
      fs.mkdirSync(path.join(payloadDir, dir), { recursive: true });
    }

    // Application archive.
    const appArchive = path.join(payloadDir, 'app.7z');
    const pack = spawnSync(path.resolve(sevenZip), ['a', appArchive, '.', '-x!*.map'], {
      cwd: path.resolve(appDir),
      encoding: 'utf8',
    });
    if (pack.status !== 0) fail(`7za failed packing app dir:\n${pack.stdout}\n${pack.stderr}`);

    // Tools.
    const sevenZipBytes = fs.readFileSync(sevenZip);
    fs.writeFileSync(path.join(payloadDir, 'tools', '7za.exe'), sevenZipBytes);
    fs.writeFileSync(path.join(payloadDir, 'tools', '7za.sha256'), sha256(sevenZipBytes));

    // Components: build-tar layout is <key>.7z/.version/.sha256/.sentinel-sha256;
    // the payload contract keeps the same <key> naming (the engine renames to
    // component-<key>.* when staging for the shared validator).
    const manifestPath = path.join(componentsDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) fail(`component manifest missing: ${manifestPath}`);
    for (const suffix of ['7z', 'version', 'sha256', 'sentinel-sha256']) {
      for (const file of fs.readdirSync(componentsDir)) {
        if (!file.endsWith('.' + suffix)) continue;
        fs.copyFileSync(path.join(componentsDir, file), path.join(payloadDir, 'components', file));
      }
    }

    fs.copyFileSync(manifestPath, path.join(payloadDir, 'component-manifest.json'));
    fs.copyFileSync(
      path.join(projectRoot, 'scripts', 'nsis-offline-components.json'),
      path.join(payloadDir, 'component-targets.json'),
    );
    for (const script of [
      'validate-offline-components.ps1',
      'recover-component-switch.ps1',
      'activate-components.ps1',
      'link-runtime-junctions.ps1',
      'cleanup-after-install.ps1',
      'uninstall-cleanup.ps1',
    ]) {
      fs.copyFileSync(
        path.join(projectRoot, 'scripts', 'installer', script),
        path.join(payloadDir, 'scripts', script),
      );
    }
    fs.copyFileSync(
      path.join(projectRoot, 'scripts', 'nsis-elevated-actions.ps1'),
      path.join(payloadDir, 'scripts', 'elevated-actions.ps1'),
    );
    fs.copyFileSync(
      path.join(projectRoot, 'resources', 'vc_redist.x64.exe'),
      path.join(payloadDir, 'vc_redist.x64.exe'),
    );
    fs.writeFileSync(path.join(payloadDir, 'version.txt'), packageVersion);

    // Zip the payload directory.
    payloadZip = path.join(staging, 'payload.zip');
    const zip = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Compress-Archive -Path "' +
          payloadDir +
          '\\*" -DestinationPath "' +
          payloadZip +
          '" -Force',
      ],
      { encoding: 'utf8' },
    );
    if (zip.status !== 0) fail(`Compress-Archive failed:\n${zip.stdout}\n${zip.stderr}`);
    console.log(`[pack-setup] assembled payload (${fs.statSync(payloadZip).size} bytes)`);
  }

  // Append [zip][size LE 8B]["ZYP1"] to the shell exe.
  const outPath = path.resolve(outArg || `ZhiYuanAgent-Setup-${packageVersion}.exe`);
  const exeBytes = fs.readFileSync(shellExe);
  const zipBytes = fs.readFileSync(payloadZip);
  const tail = Buffer.alloc(12);
  tail.writeBigUInt64LE(BigInt(zipBytes.length), 0);
  tail.write('ZYP1', 8, 'ascii');
  fs.writeFileSync(outPath, Buffer.concat([exeBytes, zipBytes, tail]));
  console.log(`[pack-setup] wrote ${outPath} (${exeBytes.length}+${zipBytes.length}+12 bytes)`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
