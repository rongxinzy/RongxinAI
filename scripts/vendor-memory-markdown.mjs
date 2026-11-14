import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = path.join(root, 'vendor/memory-markdown');
const originalFile = path.join(directory, 'memory-markdown-0.3.1.upstream.tgz');
const patchedFile = path.join(directory, 'memory-markdown-0.3.1-zhiyuan.2.tgz');
const integrity =
  'sha512-8iEOIhU7ZS+Bvut8e43sc+YAM7QaogieGRSZTSrLKI53F2hmCOhktxmq7laNhC3rc07qBbYV4i4FIKM47tDixA==';
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(bytes).digest(encoding);

function unpack(archive) {
  const bytes = gunzipSync(archive);
  const entries = new Map();
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString().replace(/\0.*$/, '');
    const filename = prefix ? `${prefix}/${name}` : name;
    assert(
      !filename.split('/').includes('..') && !path.posix.isAbsolute(filename),
      'Unsafe npm archive path',
    );
    const size = parseInt(
      header.subarray(124, 136).toString().replace(/\0.*$/, '').trim() || '0',
      8,
    );
    assert(
      Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= bytes.length,
      'Invalid tar size',
    );
    const type = header[156];
    assert([0, 48, 53].includes(type), `Unsupported npm archive entry ${type}`);
    if (type !== 53)
      entries.set(filename, Buffer.from(bytes.subarray(offset + 512, offset + 512 + size)));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function pack(entries) {
  const chunks = [];
  for (const [filename, bytes] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    assert(Buffer.byteLength(filename) <= 100, 'A tar path exceeds the reproducible USTAR limit');
    const header = Buffer.alloc(512);
    header.write(filename, 0);
    const octal = (value, start, length) =>
      header.write(value.toString(8).padStart(length - 1, '0') + '\0', start, length);
    octal(0o644, 100, 8);
    octal(0, 108, 8);
    octal(0, 116, 8);
    octal(bytes.length, 124, 12);
    octal(0, 136, 12);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write('ustar\0', 257);
    header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    chunks.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  const result = gzipSync(Buffer.concat(chunks), { level: 9 });
  result[9] = 255;
  return result;
}

const original = await readFile(originalFile);
assert.equal(
  `sha512-${digest(original, 'sha512', 'base64')}`,
  integrity,
  'Official npm archive integrity mismatch',
);
const upstream = unpack(original);
const patched = new Map(upstream);
const manifest = JSON.parse(upstream.get('package/package.json').toString());
manifest.peerDependenciesMeta = {
  ...manifest.peerDependenciesMeta,
  '@sigrun/sigrun': { optional: true },
};
patched.set('package/package.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
for (const file of ['package/dist/degenerate.d.ts', 'package/dist/target.d.ts']) {
  const declaration = upstream.get(file).toString();
  assert(declaration.includes('"@sigrun/sigrun/extension"'));
  patched.set(
    file,
    Buffer.from(declaration.replaceAll('"@sigrun/sigrun/extension"', '"./sigrun-host-types.js"')),
  );
}
patched.set(
  'package/dist/sigrun-host-types.d.ts',
  await readFile(path.join(directory, 'sigrun-host-types.d.ts')),
);
const runtimeFile = 'package/dist/files.js';
let runtime = upstream.get(runtimeFile).toString();
const runtimePatch = JSON.parse(
  await readFile(path.join(directory, 'canonical-atomic-write.patch.json'), 'utf8'),
);
for (const { before, after } of runtimePatch) {
  assert.equal(runtime.split(before).length - 1, 1, 'Atomic-write patch anchor is not unique');
  runtime = runtime.replace(before, after);
}
patched.set(runtimeFile, Buffer.from(runtime));
const expected = pack(patched);
if (process.argv.includes('--build')) await writeFile(patchedFile, expected);
const actual = await readFile(patchedFile);
assert(actual.equals(expected), 'Patched npm archive is not reproducible');
const installed = unpack(actual);
const javascript = [...upstream.keys()].filter(file => file.endsWith('.js'));
for (const file of javascript)
  assert(
    installed.get(file)?.equals(file === runtimeFile ? patched.get(file) : upstream.get(file)),
    `Unexpected JavaScript change: ${file}`,
  );
assert.deepEqual(
  [...installed.keys()].filter(file => file.endsWith('.js')).sort(),
  javascript.sort(),
  'Unexpected JavaScript implementation added',
);
console.log(
  JSON.stringify({
    package: '@sigrun/memory-markdown@0.3.1',
    upstreamSha256: digest(original),
    patchedSha256: digest(actual),
    unchangedJavaScriptFiles: javascript.length - 1,
    patchedJavaScriptFiles: [runtimeFile],
  }),
);
