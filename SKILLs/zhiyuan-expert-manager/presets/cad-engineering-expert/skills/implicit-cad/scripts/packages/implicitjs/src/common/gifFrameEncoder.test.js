import assert from "node:assert/strict";
import test from "node:test";

import {
  encodeGifFrameImageData,
  resolveTransparentPaletteIndex
} from "./gifFrameEncoder.js";

// gifenc's rgba4444 palette rows are [r, g, b, a] with a 4-bit alpha (0-15).

test("resolveTransparentPaletteIndex picks the LAST fully transparent slot", () => {
  const palette = [
    [10, 20, 30, 15], // opaque
    [40, 50, 60, 0],
    [70, 80, 90, 15],
    [1, 2, 3, 0]
  ];
  assert.equal(resolveTransparentPaletteIndex(palette), 3);
});

test("resolveTransparentPaletteIndex returns -1 when every slot is opaque", () => {
  const palette = [
    [10, 20, 30, 15],
    [40, 50, 60, 8],
    [70, 80, 90, 15]
  ];
  assert.equal(resolveTransparentPaletteIndex(palette), -1);
});

test("resolveTransparentPaletteIndex tolerates junk rows and non-arrays", () => {
  assert.equal(resolveTransparentPaletteIndex([[0, 0, 0, 15], undefined, [0, 0, 0, 0]]), 2);
  assert.equal(resolveTransparentPaletteIndex(null), -1);
});

test("a transparent frame never marks the dominant color transparent", () => {
  // Regression for the `alpha <= 127` predicate: on a gifenc build whose rgba4444
  // palettes carry RAW 4-bit alpha (0-15), that test matches EVERY entry and
  // findIndex returns 0 -- the most common OPAQUE color -- punching holes through
  // the model. The safe predicate is alpha === 0, whatever the scale.
  const width = 32;
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);
  const transparentPixels = [];
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const isCorner = (pixel % width < 4 && Math.floor(pixel / width) < 4) ||
      (pixel % width >= width - 4 && Math.floor(pixel / width) >= height - 4);
    if (isCorner) {
      // Transparent corners.
      data[offset + 3] = 0;
      transparentPixels.push(pixel);
    } else {
      // A single dominant opaque model color everywhere else.
      data[offset] = 182;
      data[offset + 1] = 196;
      data[offset + 2] = 206;
      data[offset + 3] = 255;
    }
  }

  const result = encodeGifFrameImageData({ data }, { transparent: true });

  assert.equal(result.transparent, true, "no fully transparent palette slot was found");
  assert.equal(
    Number(result.palette[result.transparentIndex]?.[3]),
    0,
    "the chosen slot must be fully transparent"
  );
  // The property that matters in the encoded output: transparent pixels index into
  // the transparent slot; model pixels index anywhere else.
  const indexed = result.indexed;
  for (const pixel of transparentPixels) {
    assert.equal(indexed[pixel], result.transparentIndex, "a transparent pixel lost its transparency");
  }
  const opaqueSample = indexed[Math.floor((width * height) / 2)];
  assert.notEqual(
    opaqueSample,
    result.transparentIndex,
    "the dominant model color resolved to the transparent slot"
  );
});

test("an opaque frame reports no transparency and keeps the zero index inert", () => {
  const width = 8;
  const height = 8;
  const data = new Uint8ClampedArray(width * height * 4).fill(200);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data[pixel * 4 + 3] = 255;
  }

  const result = encodeGifFrameImageData({ data }, { transparent: true });

  assert.equal(result.transparent, false);
  assert.equal(result.transparentIndex, 0);
});

test("a non-transparent frame skips alpha quantization entirely", () => {
  const data = new Uint8ClampedArray(8 * 8 * 4).fill(120);
  for (let pixel = 0; pixel < 64; pixel += 1) {
    data[pixel * 4 + 3] = 255;
  }

  const result = encodeGifFrameImageData({ data }, { transparent: false });

  assert.equal(result.transparent, false);
  assert.equal(result.transparentIndex, 0);
});
