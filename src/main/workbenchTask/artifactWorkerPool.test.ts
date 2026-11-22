import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhotonImage } from '@silvia-odwyer/photon-node';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { WorkbenchArtifactWorkerPool } from './artifactWorkerPool';
import { ArtifactWorkerLimit, CoworkImageLimit } from './artifactWorkerConstants';
import { TextWorkerKind } from './textWorkerOperations';
import { CompanionImageIssue } from '../../shared/companion/images';
import { imageSize } from 'image-size';
import { listPresetExperts } from '../presetExpertCatalog';
import { PRESET_EXPERTS_DIR, PresetMemberLimit } from '../presetExpertSnapshot';

const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-worker-test-')));
const compiled = path.join(fixture, 'compiled');
let pool: WorkbenchArtifactWorkerPool;
beforeAll(() => {
  fs.symlinkSync(path.resolve('node_modules'), path.join(fixture, 'node_modules'), 'junction');
  execFileSync(
    process.execPath,
    [
      path.resolve('node_modules/typescript/bin/tsc'),
      '--ignoreConfig',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ESNext',
      '--types',
      'node',
      '--skipLibCheck',
      '--esModuleInterop',
      '--rootDir',
      'src',
      '--outDir',
      compiled,
      'src/main/workbenchTask/artifactWorker.ts',
    ],
    { stdio: 'inherit' },
  );
  pool = new WorkbenchArtifactWorkerPool(
    path.join(compiled, 'main/workbenchTask/artifactWorker.js'),
  );
});
afterAll(() => {
  pool?.dispose();
  fs.rmSync(fixture, { recursive: true, force: true });
});

test('model catalog updates transfer bytes and verify checksums in the shared pool', async () => {
  const update = {
    baseRevision: 1,
    revision: 2,
    updatedAt: '2026-11-20T00:00:00.000Z',
    upserts: [],
    deletes: ['owner/model'],
  };
  const raw = JSON.stringify(update);
  const fixture = {
    baseRevision: update.baseRevision,
    revision: update.revision,
    sha256: createHash('sha256').update(raw).digest('hex'),
  };
  const bytes = new TextEncoder().encode(raw).buffer;
  await expect(pool.verifyModelCatalog({ ...fixture, bytes })).resolves.toEqual(update);
  expect(bytes.byteLength).toBe(0);
  await expect(
    pool.verifyModelCatalog({
      ...fixture,
      bytes: new TextEncoder().encode(`${raw} `).buffer,
    }),
  ).rejects.toThrow('checksum mismatch');
});

test('Skill source discovery returns direct and nested directory results through the worker', async () => {
  const source = path.join(fixture, 'skill-source');
  const skill = path.join(source, 'packages', 'examples', 'worker-skill');
  const ignored = path.join(source, 'node_modules', 'nested', 'ignored-skill');
  for (const directory of [skill, ignored]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'SKILL.md'), '# Skill');
  }

  await expect(pool.findSkillSourceDirs(source)).resolves.toEqual([skill]);
  await expect(pool.findSkillSourceDirs(skill)).resolves.toEqual([skill]);
});

test('reads bundled expert catalog metadata and skips oversized definitions in the worker', async () => {
  const bundledRoot = path.resolve('SKILLs');
  const expected = listPresetExperts(bundledRoot);
  expect(expected.length).toBeGreaterThan(0);
  await expect(pool.readPresetCatalog(bundledRoot)).resolves.toEqual(expected);

  const skillsRoot = path.join(fixture, 'expert-catalog');
  const presets = path.join(skillsRoot, ...PRESET_EXPERTS_DIR);
  const valid = path.join(presets, path.basename(expected[0].path));
  const oversized = path.join(presets, 'oversized');
  fs.cpSync(expected[0].path, valid, { recursive: true });
  fs.mkdirSync(oversized);
  fs.writeFileSync(
    path.join(oversized, 'plugin.json'),
    `${' '.repeat(PresetMemberLimit.FileBytes)}{}`,
  );
  await expect(pool.readPresetCatalog(skillsRoot)).resolves.toEqual([
    { ...expected[0], path: valid },
  ]);
});

test('workspace content hashing and decoding stay within the shared worker boundary', async () => {
  const bytes = Buffer.alloc(ArtifactWorkerLimit.WorkspaceContentBytes, 65);
  bytes[0] = 0;
  const inspectSync = () => ({
    sha256: createHash('sha256').update(bytes).digest('hex'),
    text: bytes.toString('utf8'),
    binary: bytes.includes(0),
  });
  let ticks = 0;
  const interval = setInterval(() => {
    ticks += 1;
  }, 1);
  try {
    const startedSync = performance.now();
    let baseline = inspectSync();
    for (let index = 0; index < 32; index += 1) baseline = inspectSync();
    const syncMs = performance.now() - startedSync;
    expect(ticks).toBe(0);
    const startedWorker = performance.now();
    for (let index = 0; index < 32; index += 1) {
      const transferred = Uint8Array.from(bytes).buffer;
      expect(await pool.inspectContent(transferred)).toEqual(baseline);
      expect(transferred.byteLength).toBe(0);
    }
    expect(ticks).toBeGreaterThan(0);
    console.log(
      `[WorkspaceContentTest] synchronous inspection blocked for ${Math.round(syncMs)} ms; worker inspection took ${Math.round(performance.now() - startedWorker)} ms with ${ticks} main-thread timer ticks`,
    );
  } finally {
    clearInterval(interval);
  }
  await expect(
    pool.inspectContent(new ArrayBuffer(ArtifactWorkerLimit.WorkspaceContentBytes + 1)),
  ).rejects.toThrow('input limit');
  const cancellation = new AbortController();
  const pending = pool.inspectContent(Uint8Array.from(bytes).buffer, cancellation.signal);
  cancellation.abort();
  await expect(pending).rejects.toThrow('cancelled');
});

test('tool display transforms share the bounded worker pool and support cancellation', async () => {
  expect(
    await pool.transform({
      kind: TextWorkerKind.Tool,
      result: { content: [{ text: 'first' }, { text: 'last' }] },
    }),
  ).toMatchObject({ content: 'first\nlast' });
  const cancellation = new AbortController();
  const pending = pool.transform(
    { kind: TextWorkerKind.Tool, result: { text: 'pending' } },
    cancellation.signal,
  );
  cancellation.abort();
  await expect(pending).rejects.toThrow('cancelled');
  expect(await pool.transform({ kind: TextWorkerKind.Tool, result: 'recovered' })).toMatchObject({
    content: 'recovered',
  });
});

test('Cowork attachment decoding returns transferable bytes and a content key', async () => {
  const bytes = Buffer.alloc(4 * 1024 * 1024, 17);
  const data = `data:image/png;base64,${bytes.toString('base64')}`;
  const decoded = await pool.decodeCoworkImage(data);
  expect(decoded?.hash).toBe(createHash('sha256').update(bytes).digest('hex').slice(0, 32));
  expect(decoded && Buffer.from(decoded.bytes).equals(bytes)).toBe(true);
  await expect(pool.decodeCoworkImage('!')).resolves.toBeNull();

  const abort = new AbortController();
  const decoding = pool.decodeCoworkImage(data, abort.signal);
  abort.abort();
  await expect(decoding).rejects.toThrow('cancelled');
});

test('Cowork attachment reads encode bytes off-thread and bound the opened file', async () => {
  const file = path.join(fixture, 'cowork-read.png');
  const bytes = Buffer.alloc(4 * 1024 * 1024, 91);
  await fs.promises.writeFile(file, bytes);
  expect(await pool.readCoworkImage(file)).toBe(bytes.toString('base64'));

  const abort = new AbortController();
  const reading = pool.readCoworkImage(file, abort.signal);
  abort.abort();
  await expect(reading).rejects.toThrow('cancelled');
  await fs.promises.truncate(file, CoworkImageLimit.Bytes + 1);
  await expect(pool.readCoworkImage(file)).resolves.toBe('');
  await expect(pool.readCoworkImage(`${file}.missing`)).rejects.toThrow('ENOENT');
});

test('the worker scans GGUF paths, preserves the model projection, and survives cancellation', async () => {
  const directory = path.join(fixture, 'models');
  const installed = path.join(directory, 'installed');
  const external = path.join(fixture, 'external-models');
  await fs.promises.mkdir(installed, { recursive: true });
  await fs.promises.mkdir(external);
  for (const name of [
    'a-00001-of-00002.gguf',
    'a-00002-of-00002.gguf',
    'a.mmproj.gguf',
    'b.gguf',
  ]) {
    await fs.promises.writeFile(path.join(installed, name), 'fixture');
  }
  await fs.promises.writeFile(path.join(external, 'other.gguf'), 'external');
  await fs.promises.symlink(directory, path.join(installed, 'cycle'), 'junction');
  await fs.promises.symlink(external, path.join(directory, 'linked'), 'junction');

  const cancellation = new AbortController();
  const pending = pool.scanLocalModels(directory, cancellation.signal);
  cancellation.abort();
  await expect(pending).rejects.toThrow('cancelled');
  await expect(pool.scanLocalModels('invalid\0directory')).rejects.toThrow(
    'Invalid local model directory',
  );

  const models = await pool.scanLocalModels(directory);
  expect(models).toMatchObject([
    { name: 'installed', path: path.join(installed, 'a-00001-of-00002.gguf'), size: 7 },
    { name: 'installed/b', path: path.join(installed, 'b.gguf'), size: 7 },
    { name: 'linked', path: path.join(directory, 'linked', 'other.gguf'), size: 8 },
  ]);

  const key = Buffer.from('llama.block_count');
  const header = Buffer.alloc(32);
  header.write('GGUF');
  header.writeUInt32LE(3, 4);
  header.writeBigUInt64LE(1n, 16);
  header.writeBigUInt64LE(BigInt(key.length), 24);
  const value = Buffer.alloc(8);
  value.writeUInt32LE(4);
  value.writeUInt32LE(48, 4);
  const placementModel = path.join(installed, 'b.gguf');
  await fs.promises.writeFile(placementModel, Buffer.concat([header, key, value]));
  await expect(pool.readGgufPlacement(placementModel)).resolves.toMatchObject({ blockCount: 48 });
});

test('image preparation uses actual bytes, bounds pixels before decoding and stays off the event loop', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const imagePath = path.join(fixture, 'looks-like-a-text-file.txt');
  fs.writeFileSync(imagePath, png);
  const source = { id: randomUUID(), name: 'selected.png', path: imagePath };
  let ticks = 0;
  const interval = setInterval(() => {
    ticks++;
  }, 1);
  try {
    const prepared = await pool.prepareImages([source]);
    expect(prepared).toEqual([
      { id: source.id, name: source.name, mimeType: 'image/png', data: png.toString('base64') },
    ]);
    expect(ticks).toBeGreaterThan(0);
    console.log(`[CompanionImagesTest] image preparation yielded ${ticks} main-thread timer ticks`);
  } finally {
    clearInterval(interval);
  }
  const huge = Buffer.from(png);
  huge.writeUInt32BE(100_000, 16);
  huge.writeUInt32BE(100_000, 20);
  fs.writeFileSync(imagePath, huge);
  await expect(pool.prepareImages([source])).rejects.toThrow(CompanionImageIssue.TooLarge);
  fs.writeFileSync(imagePath, 'not an image');
  await expect(pool.prepareImages([source])).rejects.toThrow();
  fs.writeFileSync(imagePath, png);
  const cancellation = new AbortController();
  const pending = pool.prepareImages([source], cancellation.signal);
  cancellation.abort();
  await expect(pending).rejects.toThrow('cancelled');
  expect((await pool.prepareImages([source]))[0].mimeType).toBe('image/png');
  await expect(pool.prepareImages(Array(11).fill(source))).rejects.toThrow('selection');
});

test('a real large bitmap is resized and converted by Photon without blocking the main thread', async () => {
  const width = 4096,
    height = 2048;
  const bmp = Buffer.alloc(54 + width * height * 3, 187);
  bmp.fill(0, 0, 54);
  bmp.write('BM');
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  const file = path.join(fixture, 'large.bmp');
  fs.writeFileSync(file, bmp);
  let ticks = 0;
  const interval = setInterval(() => {
    ticks++;
  }, 1);
  const started = performance.now();
  try {
    const [image] = await pool.prepareImages([{ id: randomUUID(), name: 'large.bmp', path: file }]);
    expect(image.mimeType).toBe('image/png');
    expect(imageSize(Buffer.from(image.data, 'base64'))).toMatchObject({
      width: 2000,
      height: 1000,
    });
    expect(ticks).toBeGreaterThan(0);
    console.log(
      `[CompanionImagesTest] large bitmap prepared in ${Math.round(performance.now() - started)} ms with ${ticks} main-thread timer ticks`,
    );
  } finally {
    clearInterval(interval);
  }
});

test('oriented JPEG and WebP files are encoded upright', async () => {
  const width = 6;
  const height = 4;
  const source = new PhotonImage(new Uint8Array(width * height * 4).fill(255), width, height);
  const exif = Buffer.from('49492a0008000000010012010300010000000600000000000000', 'hex');
  let jpeg: Buffer;
  let webp: Buffer;
  try {
    jpeg = Buffer.from(source.get_bytes_jpeg(80));
    webp = Buffer.from(source.get_bytes_webp());
  } finally {
    source.free();
  }
  const jpegExif = Buffer.concat([
    Buffer.from([0xff, 0xe1, 0, exif.length + 8]),
    Buffer.from('Exif\0\0'),
    exif,
  ]);
  const webpExtended = Buffer.alloc(18);
  webpExtended.write('VP8X');
  webpExtended.writeUInt32LE(10, 4);
  webpExtended[8] = 0x08;
  webpExtended[12] = width - 1;
  webpExtended[15] = height - 1;
  const webpExif = Buffer.alloc(8);
  webpExif.write('EXIF');
  webpExif.writeUInt32LE(exif.length, 4);
  const orientedWebp = Buffer.concat([
    webp.subarray(0, 12),
    webpExtended,
    webp.subarray(12),
    webpExif,
    exif,
  ]);
  orientedWebp.writeUInt32LE(orientedWebp.length - 8, 4);
  const files = [
    ['oriented.jpg', Buffer.concat([jpeg.subarray(0, 2), jpegExif, jpeg.subarray(2)])],
    ['oriented.webp', orientedWebp],
  ] as const;
  const inputs = files.map(([name, bytes]) => {
    const file = path.join(fixture, name);
    fs.writeFileSync(file, bytes);
    return { id: randomUUID(), name, path: file };
  });
  const outputs = await pool.prepareImages(inputs);
  expect(outputs.map(image => image.mimeType)).toEqual(['image/jpeg', 'image/png']);
  for (const image of outputs) {
    expect(imageSize(Buffer.from(image.data, 'base64'))).toMatchObject({
      width: height,
      height: width,
    });
  }
});
