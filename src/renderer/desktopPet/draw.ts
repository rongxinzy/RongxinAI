import { DESKTOP_PET_SIZE } from '../../shared/desktopPet/constants';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import type { DesktopPetAtlas } from './atlas';
import { originalPoseGeometry } from './poseGeometry';
import { drawPetMedia } from './mediaGeometry';

export { drawPetMedia } from './mediaGeometry';

const masks = new WeakMap<
  DesktopPetAtlas,
  { image: HTMLImageElement | undefined; values: Map<string, Uint8Array> }
>();

export function drawPetPose(
  target: CanvasRenderingContext2D,
  atlas: DesktopPetAtlas,
  index: number,
  scaleY = 1,
  facing = 1,
  rotate = 0,
  offsetX = 0,
  offsetY = 0,
): void {
  if (!atlas.image) return;
  const source = atlas.frame(index);
  const original = atlas.character.id === DesktopPetBuiltinId.Xiaoyuan;
  // Preserve the first-release proportions and baseline when returning from authored idle.
  const unit = (DESKTOP_PET_SIZE * (original ? 1 : 0.82)) / source.unit;
  const height = source.height * unit;
  const width = source.width * unit;
  const fit = original
    ? originalPoseGeometry(index, scaleY, facing, rotate, offsetX, offsetY)
    : {
        x: DESKTOP_PET_SIZE / 2 + offsetX,
        y: DESKTOP_PET_SIZE - 12 + offsetY,
        scale: 1,
      };
  target.save();
  target.translate(fit.x, fit.y);
  target.rotate(rotate);
  target.scale((fit.scale * facing) / Math.sqrt(scaleY), fit.scale * scaleY);
  target.drawImage(
    atlas.image,
    source.x,
    source.y,
    source.width,
    source.height,
    -width / 2,
    -height,
    width,
    height,
  );
  target.restore();
}

/** Cache active-pose envelopes; transparent space reserved for other poses stays click-through. */
export function petHitMask(
  atlas: DesktopPetAtlas,
  reduced: boolean,
  indices: number[],
): Uint8Array {
  let cache = masks.get(atlas);
  if (!cache || cache.image !== atlas.image) {
    cache = { image: atlas.image, values: new Map() };
    masks.set(atlas, cache);
  }
  const key = `${reduced}:${indices.join(',')}`;
  const cached = cache.values.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = DESKTOP_PET_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const alpha = new Uint8Array(DESKTOP_PET_SIZE * DESKTOP_PET_SIZE);
  if (!context) return alpha;
  if (reduced) {
    for (const index of indices) {
      drawPetPose(context, atlas, index);
      drawPetPose(context, atlas, index, 1, -1);
    }
  } else {
    for (const sprite of indices)
      for (const facing of [-1, 1])
        for (const rotate of [-0.16, 0, 0.16])
          for (const scale of [0.86, 1, 1.13])
            for (const [x, y] of [
              [-8, -18],
              [8, -18],
              [-8, 6],
              [8, 6],
              [0, 0],
            ])
              drawPetPose(context, atlas, sprite, scale, facing, rotate, x, y);
  }
  const pixels = context.getImageData(0, 0, DESKTOP_PET_SIZE, DESKTOP_PET_SIZE).data;
  // Match the native hit threshold and discard accumulated subpixel alpha at the edge.
  for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3] > 32 ? 255 : 0;
  if (!reduced && atlas.character.id === DesktopPetBuiltinId.Xiaoyuan) {
    // Fit-to-canvas can translate an intermediate pose between sampled extrema.
    // A two-DIP fringe covers that interpolation without intercepting empty corners.
    const sampled = alpha.slice();
    for (let y = 2; y < DESKTOP_PET_SIZE - 2; y++)
      for (let x = 2; x < DESKTOP_PET_SIZE - 2; x++) {
        const index = y * DESKTOP_PET_SIZE + x;
        if (!sampled[index]) continue;
        for (let dy = -2; dy <= 2; dy++)
          alpha.fill(255, index + dy * DESKTOP_PET_SIZE - 2, index + dy * DESKTOP_PET_SIZE + 3);
      }
  }
  if (cache.values.size >= 32) cache.values.delete(cache.values.keys().next().value!);
  cache.values.set(key, alpha);
  return alpha;
}

// One full character pack: 24 masks and 24 loading posters, at most 1.7 MiB.
const MAX_MEDIA_MASKS = 48;
const mediaMasks = new Map<string, Uint8Array>();
let maskContext: CanvasRenderingContext2D | null | undefined;

/** Immutable asset URLs share their envelope across video slots and repeated actions. */
export function petMediaHitMask(images: HTMLImageElement[]): Uint8Array {
  const combined = new Uint8Array(DESKTOP_PET_SIZE * DESKTOP_PET_SIZE);
  for (const image of images) {
    const source = image.src;
    let value = mediaMasks.get(source);
    if (!value) {
      if (maskContext === undefined) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = DESKTOP_PET_SIZE;
        maskContext = canvas.getContext('2d', { willReadFrequently: true });
      }
      if (!maskContext) continue;
      const context = maskContext;
      context.clearRect(0, 0, DESKTOP_PET_SIZE, DESKTOP_PET_SIZE);
      for (const facing of [-1, 1])
        for (const rotate of [-0.16, 0, 0.16])
          for (const scale of [0.86, 1, 1.13])
            for (const [x, y] of [
              [-8, -18],
              [8, -18],
              [-8, 6],
              [8, 6],
              [0, 0],
            ])
              drawPetMedia(context, image, scale, facing, rotate, x, y);
      const pixels = context.getImageData(0, 0, DESKTOP_PET_SIZE, DESKTOP_PET_SIZE).data;
      value = new Uint8Array(combined.length);
      for (let index = 0; index < value.length; index++)
        value[index] = pixels[index * 4 + 3] > 32 ? 255 : 0;
    }
    // Refresh recency without keeping image objects or their decoded surfaces alive.
    mediaMasks.delete(source);
    if (mediaMasks.size >= MAX_MEDIA_MASKS) mediaMasks.delete(mediaMasks.keys().next().value!);
    mediaMasks.set(source, value);
    for (let index = 0; index < combined.length; index++) combined[index] |= value[index];
  }
  return combined;
}
