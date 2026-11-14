import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from 'image-size';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { WorkbenchArtifactWorkerPool } from './artifactWorkerPool';
import { ArtifactWorkerLimit } from './artifactWorkerConstants';
import {
  bitmap,
  buildDurableImageFixture,
  imageLimits,
  onePixelPng,
} from './durableImage.testHarness';

let directory: string;
let pool: WorkbenchArtifactWorkerPool;
const input = (bytes: Uint8Array = onePixelPng, mimeType = 'image/png') => ({
  bytes: Uint8Array.from(bytes).buffer,
  mimeType,
  limits: imageLimits,
});
beforeAll(async () => {
  directory = await buildDurableImageFixture();
  pool = new WorkbenchArtifactWorkerPool(path.join(directory, 'artifactWorker.js'));
}, 30_000);
afterAll(() => {
  pool?.dispose();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

test('standalone packaged worker preserves PNG and resizes real BMP off the event loop', async () => {
  expect(fs.existsSync(path.join(directory, 'node_modules'))).toBe(false);
  const source = fs.readFileSync(path.join(directory, 'artifactWorker.js'), 'utf8');
  expect(source).not.toMatch(/require\(["'](?:@earendil-works|@silvia-odwyer|image-size)/);
  const png = input();
  expect(await pool.prepareDurableImage(png)).toEqual({
    data: onePixelPng.toString('base64'),
    mimeType: 'image/png',
  });
  expect(png.bytes.byteLength).toBe(0);
  let ticks = 0;
  const timer = setInterval(() => {
    ticks++;
  }, 1);
  const started = performance.now();
  try {
    const image = await pool.prepareDurableImage(input(bitmap(), 'image/bmp'));
    expect(image).toMatchObject({
      mimeType: 'image/png',
      convertedFrom: 'image/bmp',
      resized: { from: { width: 4096, height: 2048 }, to: { width: 2000, height: 1000 } },
    });
    expect(imageSize(Buffer.from(image!.data, 'base64'))).toMatchObject({
      width: 2000,
      height: 1000,
    });
    expect(ticks).toBeGreaterThan(0);
    console.log(
      `[DurableImagesTest] standalone BMP decode took ${Math.round(performance.now() - started)} ms with ${ticks} main-thread ticks`,
    );
  } finally {
    clearInterval(timer);
  }
});

test('bounds bytes, dimensions and requested output before Photon decoding', async () => {
  await expect(
    pool.prepareDurableImage(input(new Uint8Array(ArtifactWorkerLimit.ImageBytes + 1))),
  ).rejects.toThrow('input limit');
  await expect(
    pool.prepareDurableImage({ ...input(), limits: { ...imageLimits, maxWidth: 0 } }),
  ).rejects.toThrow('output limits');
  await expect(
    pool.prepareDurableImage({ ...input(), limits: { ...imageLimits, maxBytes: Infinity } }),
  ).rejects.toThrow('output limits');
  const huge = Buffer.from(onePixelPng);
  huge.writeUInt32BE(100_000, 16);
  huge.writeUInt32BE(100_000, 20);
  await expect(pool.prepareDurableImage(input(huge))).rejects.toThrow('pixel limit');
  expect(await pool.prepareDurableImage(input(Buffer.from('broken image')))).toBeUndefined();
  expect(await pool.prepareDurableImage(input(onePixelPng, 'image/jpeg'))).toBeUndefined();
});

test('worker start or packaged WASM failures reject without decoding on main', async () => {
  const missing = new WorkbenchArtifactWorkerPool(path.join(directory, 'missingWorker.js'));
  try {
    await expect(missing.prepareDurableImage(input())).rejects.toThrow();
  } finally {
    missing.dispose();
  }
  const wasm = path.join(directory, 'companion-photon.wasm');
  fs.renameSync(wasm, `${wasm}.hidden`);
  try {
    await expect(pool.prepareDurableImage(input())).rejects.toThrow('ENOENT');
  } finally {
    fs.renameSync(`${wasm}.hidden`, wasm);
  }
  expect(await pool.prepareDurableImage(input())).toBeDefined();
});

test('cancels active decoding, retires its worker and can process the next image', async () => {
  const cancellation = new AbortController();
  const pending = pool.prepareDurableImage(input(bitmap(), 'image/bmp'), cancellation.signal);
  cancellation.abort();
  await expect(pending).rejects.toThrow('cancelled');
  expect(await pool.prepareDurableImage(input())).toBeDefined();
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(pool.prepareDurableImage(input(), cancelled.signal)).rejects.toThrow('cancelled');
});

test('times out nonresponsive workers and rejects work after pool disposal', async () => {
  const timed = new WorkbenchArtifactWorkerPool(
    path.join(directory, 'nonresponsiveWorker.cjs'),
    25,
  );
  try {
    await expect(timed.prepareDurableImage(input())).rejects.toThrow('timed out');
  } finally {
    timed.dispose();
  }
  await expect(timed.prepareDurableImage(input())).rejects.toThrow('closed');
});

test('bounds queued jobs and pending bytes and cancels a queued image without dispatch', async () => {
  const busy = new WorkbenchArtifactWorkerPool(path.join(directory, 'nonresponsiveWorker.cjs'));
  const cancellation = new AbortController();
  const pending = [];
  try {
    for (let index = 0; index < ArtifactWorkerLimit.Workers + ArtifactWorkerLimit.Queue; index++) {
      pending.push(
        busy
          .prepareDurableImage(input(), index === 2 ? cancellation.signal : undefined)
          .catch(error => error),
      );
    }
    await expect(busy.prepareDurableImage(input())).rejects.toThrow('queue is full');
    cancellation.abort();
    expect(await pending[2]).toMatchObject({ message: 'Artifact worker task cancelled.' });
  } finally {
    busy.dispose();
    await Promise.all(pending);
  }
  const large = new WorkbenchArtifactWorkerPool(path.join(directory, 'nonresponsiveWorker.cjs'));
  const largePending = [];
  try {
    for (let index = 0; index < 2; index++)
      largePending.push(
        large
          .prepareDurableImage(input(new Uint8Array(ArtifactWorkerLimit.ImageBytes)))
          .catch(error => error),
      );
    await expect(large.prepareDurableImage(input())).rejects.toThrow('pending byte limit');
  } finally {
    large.dispose();
    await Promise.all(largePending);
  }
});

test('bundled ImageProcessor reads the current cancellation signal and preserves caller bytes', () => {
  const script = path.join(directory, 'processor-check.cjs');
  fs.writeFileSync(
    script,
    `
const assert = require('node:assert/strict');
const { createDurableImageProcessor } = require('./imageProcessor.js');
const bytes = Buffer.from('${onePixelPng.toString('base64')}', 'base64');
let controller = new AbortController();
const processor = createDurableImageProcessor(() => controller.signal);
(async () => {
  controller.abort();
  await assert.rejects(processor.prepare(bytes, 'image/png', ${JSON.stringify(imageLimits)}), /cancelled/);
  controller = new AbortController();
  const image = await processor.prepare(bytes, 'image/png', ${JSON.stringify(imageLimits)});
  assert.equal(image.data, bytes.toString('base64'));
  assert.equal(bytes.byteLength, ${onePixelPng.byteLength});
})().catch(error => { console.error(error); process.exitCode = 1; });
`,
  );
  execFileSync(process.execPath, [script], { cwd: directory, stdio: 'pipe', timeout: 10_000 });
});
