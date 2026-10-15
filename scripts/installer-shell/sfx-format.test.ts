import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { appendPayload, inspectSetup, writeSetupManifest } = require('./sfx-format.cjs');
const roots: string[] = [];
const peOffset = 128;
const optionalOffset = peOffset + 24;
const certificateDirectory = optionalOffset + 144;

function fixture(extraZipBytes = 0) {
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-sfx-'));
  roots.push(root);
  const shell = path.join(root, 'shell.exe');
  const zip = path.join(root, 'payload.zip');
  const output = path.join(root, 'setup.exe');
  const pe = Buffer.alloc(512);
  pe.write('MZ');
  pe.writeUInt32LE(peOffset, 60);
  pe.writeUInt32LE(0x4550, peOffset);
  pe.writeUInt16LE(0x8664, peOffset + 4);
  pe.writeUInt16LE(1, peOffset + 6);
  pe.writeUInt16LE(240, peOffset + 20);
  pe.writeUInt16LE(0x20b, optionalOffset);
  pe.writeUInt32LE(16, optionalOffset + 108);
  writeFileSync(shell, pe);
  const payload = Buffer.alloc(22 + extraZipBytes);
  payload.writeUInt32LE(0x06054b50);
  writeFileSync(zip, payload);
  return { shell, zip, output };
}

// This models the PE container changes made by SignTool, not a trusted
// signature. Windows release jobs must still exercise real Certum signatures.
function appendCertificate(file: string, length = 1024) {
  const bytes = readFileSync(file);
  const certificate = Buffer.alloc(Math.ceil(length / 8) * 8);
  certificate.writeUInt32LE(length, 0);
  certificate.writeUInt16LE(0x200, 4);
  certificate.writeUInt16LE(2, 6);
  bytes.writeUInt32LE(bytes.length, certificateDirectory);
  bytes.writeUInt32LE(certificate.length, certificateDirectory + 4);
  writeFileSync(file, Buffer.concat([bytes, certificate]));
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test.each([0, 1, 2, 3, 4, 5, 6, 7])(
  'unsigned and signed payload offsets agree with alignment %i',
  extra => {
    const files = fixture(extra);
    const before = appendPayload(files.shell, files.zip, files.output);
    expect(before).toMatchObject({
      format: 'ZYP2',
      shellBytes: 512,
      payloadBytes: 22 + extra,
      signed: false,
    });
    expect(before.installerBytes % 8).toBe(0);
    appendCertificate(files.output, 1017);
    expect(inspectSetup(files.output)).toMatchObject({
      shellBytes: before.shellBytes,
      payloadBytes: before.payloadBytes,
      certificateBytes: 1024,
      signed: true,
    });
  },
);

test('final manifest hashes signed bytes and rejects signing before payload assembly', () => {
  const files = fixture();
  appendPayload(files.shell, files.zip, files.output);
  const unsigned = writeSetupManifest(files.output, '2026.10.15');
  appendCertificate(files.output);
  const signed = writeSetupManifest(files.output, '2026.10.15');
  expect(signed.sha256).not.toBe(unsigned.sha256);
  expect(JSON.parse(readFileSync(`${files.output}.manifest.json`, 'utf8'))).toMatchObject({
    version: '2026.10.15',
    signed: true,
    sha256: signed.sha256,
  });
  appendCertificate(files.shell);
  expect(() => appendPayload(files.shell, files.zip, files.output)).toThrow(/before signing/);
});

test.each([
  ['trailing junk', (b: Buffer) => Buffer.concat([b, Buffer.from('ZYP2')])],
  [
    'certificate offset',
    (b: Buffer) => {
      b.writeUInt32LE(64, certificateDirectory);
      return b;
    },
  ],
  [
    'certificate length',
    (b: Buffer) => {
      b.writeUInt32LE(4096, certificateDirectory + 4);
      return b;
    },
  ],
  [
    'certificate record',
    (b: Buffer) => {
      b.writeUInt32LE(0, b.length - 1024);
      return b;
    },
  ],
  [
    'footer size',
    (b: Buffer) => {
      b.writeUInt32LE(12, b.length - 1024 - 8);
      return b;
    },
  ],
  [
    'payload offset overflow',
    (b: Buffer) => {
      b.writeBigUInt64LE(2n ** 63n, b.length - 1024 - 24);
      return b;
    },
  ],
  [
    'payload size overflow',
    (b: Buffer) => {
      b.writeBigUInt64LE(2n ** 63n, b.length - 1024 - 16);
      return b;
    },
  ],
  [
    'padding',
    (b: Buffer) => {
      b[534] = 1;
      return b;
    },
  ],
] as const)('rejects malformed signed %s', (_name, mutate) => {
  const files = fixture();
  appendPayload(files.shell, files.zip, files.output);
  appendCertificate(files.output);
  writeFileSync(files.output, mutate(readFileSync(files.output)));
  expect(() => inspectSetup(files.output)).toThrow();
});

test('never finds a payload footer inside certificate data', () => {
  const files = fixture();
  appendPayload(files.shell, files.zip, files.output);
  const unsigned = readFileSync(files.output);
  appendCertificate(files.output);
  const bytes = readFileSync(files.output);
  unsigned.copy(bytes, bytes.length - 24, unsigned.length - 24);
  bytes.fill(0, unsigned.length - 4, unsigned.length);
  writeFileSync(files.output, bytes);
  expect(() => inspectSetup(files.output)).toThrow(/footer/);
});

test('rejects replacing input files and non-x64 executables', () => {
  const files = fixture();
  expect(() => appendPayload(files.shell, files.zip, files.shell)).toThrow(/overwrite/);
  const bytes = readFileSync(files.shell);
  bytes.writeUInt16LE(0x14c, peOffset + 4);
  writeFileSync(files.shell, bytes);
  expect(() => appendPayload(files.shell, files.zip, files.output)).toThrow(/x64/);
});
