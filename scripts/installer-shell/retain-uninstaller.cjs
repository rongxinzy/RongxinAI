'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sha256File } = require('../windows-resource-pack.cjs');

function retainedHostPath(root) {
  return path.join(root, 'scripts', 'installer-shell', 'out', 'ZhiYuanUninstall.exe');
}

function context(root) {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const config = JSON.parse(fs.readFileSync(path.join(root, 'electron-builder.json'), 'utf8'));
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const sourceCommit = git.stdout?.trim();
  if (git.status !== 0 || !/^[a-f0-9]{40,64}$/.test(sourceCommit || '')) {
    throw new Error('Cannot bind the retained uninstaller to the checked-out source commit');
  }
  if (
    config.appId !== 'com.zhiyuanagent.app' ||
    config.nsis.artifactName !== '${productName}-Setup-${version}.${ext}'
  ) {
    throw new Error('Unexpected community NSIS artifact configuration');
  }
  const sourceFileName = `${config.productName}-Setup-${version}.__uninstaller.exe`;
  const installedFileName = `Uninstall ${config.productName}.exe`;
  return { version, sourceCommit, sourceFileName, installedFileName };
}

function assertNsisHost(file) {
  const fd = fs.openSync(file, 'r');
  try {
    // Native NSIS uses an ordinary PE followed by its firstheader signature.
    // Reject accidentally retaining the managed shell or a stale text fixture.
    const header = Buffer.alloc(64);
    if (fs.readSync(fd, header, 0, 64, 0) !== 64 || header.toString('ascii', 0, 2) !== 'MZ') {
      throw new Error('Retained uninstaller is not a native NSIS executable');
    }
    const peOffset = header.readUInt32LE(60);
    const pe = Buffer.alloc(24);
    if (fs.readSync(fd, pe, 0, 24, peOffset) !== 24 || pe.readUInt32LE(0) !== 0x4550) {
      throw new Error('Invalid native uninstaller PE header');
    }
    const sections = pe.readUInt16LE(6);
    const sectionOffset = peOffset + 24 + pe.readUInt16LE(20);
    if (sections === 0 || sections > 96) throw new Error('Invalid native uninstaller sections');
    const table = Buffer.alloc(sections * 40);
    if (fs.readSync(fd, table, 0, table.length, sectionOffset) !== table.length) {
      throw new Error('Truncated native uninstaller sections');
    }
    let overlay = sectionOffset + table.length;
    for (let offset = 0; offset < table.length; offset += 40) {
      overlay = Math.max(
        overlay,
        table.readUInt32LE(offset + 16) + table.readUInt32LE(offset + 20),
      );
    }
    const signature = Buffer.alloc(16);
    if (
      fs.readSync(fd, signature, 0, signature.length, overlay + 4) !== signature.length ||
      signature.readUInt32LE(0) !== 0xdeadbeef ||
      signature.toString('ascii', 4) !== 'NullsoftInst'
    ) {
      throw new Error('Missing native NSIS uninstaller signature');
    }
  } finally {
    fs.closeSync(fd);
  }
}

function resetRetainedHost(root) {
  const output = retainedHostPath(root);
  fs.rmSync(output, { force: true });
  fs.rmSync(`${output}.manifest.json`, { force: true });
}

function captureUninstaller(root, source) {
  const identity = context(root);
  const expected = path.resolve(root, 'release', identity.sourceFileName);
  if (path.resolve(source) !== expected) {
    throw new Error("Only this build's exact UNINSTALLER_OUT_FILE may be retained");
  }
  assertNsisHost(source);
  const sourceSha256 = sha256File(source);
  const output = retainedHostPath(root);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(source, output);
  const sha256 = sha256File(output);
  if (sha256 !== sourceSha256) throw new Error('Native uninstaller copy changed signed bytes');
  const manifest = {
    kind: 'nsis-uninstall-host',
    ...identity,
    bytes: fs.statSync(output).size,
    sha256,
    sourceSha256,
  };
  fs.writeFileSync(`${output}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `[installer-shell] retained native NSIS uninstaller (${manifest.bytes} bytes, ${sha256})`,
  );
  return manifest;
}

function verifyRetainedHost(root, file = retainedHostPath(root)) {
  const identity = context(root);
  const manifest = JSON.parse(fs.readFileSync(`${file}.manifest.json`, 'utf8'));
  if (
    manifest.kind !== 'nsis-uninstall-host' ||
    Object.entries(identity).some(([key, value]) => manifest[key] !== value) ||
    manifest.bytes !== fs.statSync(file).size ||
    manifest.sha256 !== manifest.sourceSha256 ||
    manifest.sha256 !== sha256File(file)
  ) {
    throw new Error('Retained NSIS uninstaller identity or signed bytes do not match this build');
  }
  assertNsisHost(file);
  return manifest;
}

if (require.main === module) {
  const [command, root, source] = process.argv.slice(2);
  if (!root || !['reset', 'capture'].includes(command) || (command === 'capture' && !source)) {
    throw new Error('Usage: retain-uninstaller.cjs reset|capture <project-root> [source]');
  }
  if (command === 'reset') resetRetainedHost(path.resolve(root));
  else captureUninstaller(path.resolve(root), path.resolve(source));
}

module.exports = { retainedHostPath, resetRetainedHost, captureUninstaller, verifyRetainedHost };
