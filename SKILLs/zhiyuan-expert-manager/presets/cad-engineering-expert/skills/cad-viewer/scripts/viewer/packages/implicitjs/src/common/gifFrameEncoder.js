// Transparent-GIF palette resolution for the headless snapshot entries, shared by
// implicitjs and cadjs (cadjs depends on implicitjs; see camera.js for the same
// arrangement).
//
// The bug this owns: transparent frames are quantized with `format: "rgba4444"` +
// `oneBitAlpha: true`. On a build whose palettes carry RAW 4-bit alpha (0-15), testing
// `alpha <= 127` matches EVERY palette entry and `findIndex` returns 0 -- the first,
// most common, fully opaque color -- punching holes through the model. The only
// scale-safe predicate is alpha === 0: under oneBitAlpha there is exactly ONE such
// slot (quantize dedupes exact rows), whichever position it lands in, and a raw
// 4-bit alpha of 0 is likewise the only fully transparent value.
//
// Same interop defense as the headless entries: bundlers resolve gifenc's ESM build
// (named exports), plain Node resolves its CJS build (everything on the default
// export), so neither source alone is reliable.
import gifencModule from "gifenc";
import * as gifencNamed from "gifenc";

const quantize = gifencNamed.quantize || gifencModule?.quantize;
const applyPalette = gifencNamed.applyPalette || gifencModule?.applyPalette;

export function resolveTransparentPaletteIndex(palette) {
  const entries = Array.isArray(palette) ? palette : [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (Number(entries[index]?.[3]) === 0) {
      return index;
    }
  }
  return -1;
}

export function encodeGifFrameImageData(imageData, { transparent = false } = {}) {
  if (!transparent) {
    const palette = quantize(imageData.data, 256);
    return {
      indexed: applyPalette(imageData.data, palette),
      palette,
      transparent: false,
      transparentIndex: 0
    };
  }

  const palette = quantize(imageData.data, 256, {
    format: "rgba4444",
    oneBitAlpha: true
  });
  const transparentIndex = resolveTransparentPaletteIndex(palette);
  return {
    indexed: applyPalette(imageData.data, palette, "rgba4444"),
    palette,
    transparent: transparentIndex >= 0,
    // A fully opaque frame has no transparent slot; gifenc still wants an index.
    transparentIndex: Math.max(transparentIndex, 0)
  };
}
