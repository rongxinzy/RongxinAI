'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256File } = require('../windows-resource-pack.cjs');

const MAX_SETUP_BYTES = 450 * 1024 * 1024;
const FOOTER_BYTES = 24;
const MAGIC = 'ZYP2';

function readAt(fd, count, offset, size) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + count > size) {
    throw new Error('Truncated setup container');
  }
  const buffer = Buffer.alloc(count);
  if (fs.readSync(fd, buffer, 0, count, offset) !== count) {
    throw new Error('Truncated setup container');
  }
  return buffer;
}

// The PE certificate directory uses a file offset, not an RVA. Signing appends
// an aligned certificate table, so EOF is never a reliable payload boundary.
// https://learn.microsoft.com/en-us/windows/win32/debug/pe-format
function inspectPe(fd, size) {
  const dos = readAt(fd, 64, 0, size);
  if (dos.toString('ascii', 0, 2) !== 'MZ') throw new Error('Setup is not a PE executable');
  const peOffset = dos.readUInt32LE(60);
  if (peOffset < 64) throw new Error('Invalid PE header offset');
  const pe = readAt(fd, 24, peOffset, size);
  if (pe.readUInt32LE(0) !== 0x4550 || pe.readUInt16LE(4) !== 0x8664) {
    throw new Error('Setup must be a Windows x64 PE executable');
  }
  const optionalSize = pe.readUInt16LE(20);
  if (optionalSize < 152) throw new Error('Missing PE certificate directory');
  const optional = readAt(fd, optionalSize, peOffset + 24, size);
  if (optional.readUInt16LE(0) !== 0x20b || optional.readUInt32LE(108) < 5) {
    throw new Error('Invalid PE32+ optional header');
  }
  const headerEnd = peOffset + 24 + optionalSize + pe.readUInt16LE(6) * 40;
  if (headerEnd > size) throw new Error('Truncated PE section table');
  const certificateOffset = optional.readUInt32LE(144);
  const certificateBytes = optional.readUInt32LE(148);
  if (certificateOffset === 0 && certificateBytes === 0) {
    return { headerEnd, certificateOffset, certificateBytes, contentEnd: size };
  }
  if (
    certificateOffset < headerEnd ||
    certificateOffset % 8 !== 0 ||
    certificateBytes < 8 ||
    certificateOffset + certificateBytes !== size
  )
    throw new Error('Invalid PE certificate table boundary');
  let cursor = certificateOffset;
  while (cursor < size) {
    const certificate = readAt(fd, 8, cursor, size);
    const length = certificate.readUInt32LE(0);
    if (length < 8 || certificate.readUInt16LE(4) !== 0x200 || certificate.readUInt16LE(6) !== 2) {
      throw new Error('Invalid Authenticode certificate entry');
    }
    cursor += Math.ceil(length / 8) * 8;
    if (cursor > size) throw new Error('Invalid Authenticode certificate length');
  }
  return { headerEnd, certificateOffset, certificateBytes, contentEnd: certificateOffset };
}

function inspectSetup(file) {
  const size = fs.statSync(file).size;
  if (size > MAX_SETUP_BYTES) throw new Error('Final setup exceeds the 450 MiB installer budget');
  const fd = fs.openSync(file, 'r');
  try {
    const pe = inspectPe(fd, size);
    const footerStart = pe.contentEnd - FOOTER_BYTES;
    const footer = readAt(fd, FOOTER_BYTES, footerStart, size);
    if (footer.readUInt32LE(16) !== FOOTER_BYTES || footer.toString('ascii', 20) !== MAGIC) {
      throw new Error('Missing ZYP2 setup payload footer');
    }
    const shellBytes = Number(footer.readBigUInt64LE(0));
    const payloadBytes = Number(footer.readBigUInt64LE(8));
    const padding = footerStart - shellBytes - payloadBytes;
    if (
      !Number.isSafeInteger(shellBytes) ||
      !Number.isSafeInteger(payloadBytes) ||
      shellBytes < pe.headerEnd ||
      payloadBytes < 22 ||
      padding < 0 ||
      padding > 7 ||
      pe.contentEnd % 8 !== 0
    )
      throw new Error('Invalid setup payload boundaries');
    if (readAt(fd, padding, shellBytes + payloadBytes, size).some(byte => byte !== 0)) {
      throw new Error('Invalid setup alignment padding');
    }
    const zipMagic = readAt(fd, 4, shellBytes, size).readUInt32LE(0);
    if (zipMagic !== 0x04034b50 && zipMagic !== 0x06054b50) {
      throw new Error('Setup payload is not a ZIP archive');
    }
    return {
      kind: 'webview2-single-file-setup',
      format: MAGIC,
      architecture: 'x64',
      installerBytes: size,
      shellBytes,
      payloadBytes,
      certificateBytes: pe.certificateBytes,
      // Presence is not trust. Release gates separately verify Authenticode,
      // the expected certificate DER and its trusted timestamp on Windows.
      signed: pe.certificateBytes > 0,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function appendPayload(shell, zip, output) {
  if ([shell, zip].some(file => path.resolve(file) === path.resolve(output))) {
    throw new Error('Setup output must not overwrite its inputs');
  }
  const shellBytes = fs.statSync(shell).size;
  const payloadBytes = fs.statSync(zip).size;
  const padding = (8 - ((shellBytes + payloadBytes + FOOTER_BYTES) % 8)) % 8;
  if (shellBytes + payloadBytes + padding + FOOTER_BYTES > MAX_SETUP_BYTES) {
    throw new Error('Final setup exceeds the 450 MiB installer budget');
  }
  const shellFd = fs.openSync(shell, 'r');
  try {
    if (inspectPe(shellFd, shellBytes).certificateBytes !== 0) {
      throw new Error('Append the payload before signing the setup shell');
    }
  } finally {
    fs.closeSync(shellFd);
  }
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.copyFileSync(shell, output);
  const input = fs.openSync(zip, 'r');
  const target = fs.openSync(output, 'a');
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(input, chunk, 0, chunk.length, null)) > 0) {
      fs.writeSync(target, chunk, 0, count);
    }
    fs.writeSync(target, Buffer.alloc(padding));
    const footer = Buffer.alloc(FOOTER_BYTES);
    footer.writeBigUInt64LE(BigInt(shellBytes), 0);
    footer.writeBigUInt64LE(BigInt(payloadBytes), 8);
    footer.writeUInt32LE(FOOTER_BYTES, 16);
    footer.write(MAGIC, 20, 'ascii');
    fs.writeSync(target, footer);
  } finally {
    fs.closeSync(input);
    fs.closeSync(target);
  }
  return inspectSetup(output);
}

function writeSetupManifest(file, version) {
  const manifest = { ...inspectSetup(file), version, sha256: sha256File(file) };
  fs.writeFileSync(`${file}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

module.exports = { MAX_SETUP_BYTES, FOOTER_BYTES, appendPayload, inspectSetup, writeSetupManifest };
