import { DESKTOP_PET_SIZE } from '../../shared/desktopPet/constants';
import { drawPetMedia } from './mediaGeometry';

export interface DesktopPetMediaMaskRequest {
  id: number;
  key: string;
  images: { src: string; bitmap: ImageBitmap }[];
}

export interface DesktopPetMediaMaskResponse {
  id: number;
  key: string;
  mask: ArrayBuffer;
}

const MAX_MEDIA_MASKS = 48;
const mediaMasks = new Map<string, Uint8Array>();
const canvas = new OffscreenCanvas(DESKTOP_PET_SIZE, DESKTOP_PET_SIZE);
const surface = canvas.getContext('2d', { willReadFrequently: true });
if (!surface) throw new Error('Desktop pet mask surface is unavailable');
const context: OffscreenCanvasRenderingContext2D = surface;

function mediaMask(source: string, image: ImageBitmap): Uint8Array {
  const cached = mediaMasks.get(source);
  if (cached) return cached;
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
  const value = new Uint8Array(DESKTOP_PET_SIZE * DESKTOP_PET_SIZE);
  for (let index = 0; index < value.length; index++)
    value[index] = pixels[index * 4 + 3] > 32 ? 255 : 0;
  const sampled = value.slice();
  for (let y = 1; y < DESKTOP_PET_SIZE - 1; y++)
    for (let x = 1; x < DESKTOP_PET_SIZE - 1; x++) {
      const index = y * DESKTOP_PET_SIZE + x;
      if (!sampled[index]) continue;
      for (let dy = -1; dy <= 1; dy++)
        value.fill(255, index + dy * DESKTOP_PET_SIZE - 1, index + dy * DESKTOP_PET_SIZE + 2);
    }
  if (mediaMasks.size >= MAX_MEDIA_MASKS) mediaMasks.delete(mediaMasks.keys().next().value!);
  mediaMasks.set(source, value);
  return value;
}

self.onmessage = (event: MessageEvent<DesktopPetMediaMaskRequest>) => {
  const { id, key, images } = event.data;
  const combined = new Uint8Array(DESKTOP_PET_SIZE * DESKTOP_PET_SIZE);
  for (const { src, bitmap } of images) {
    const value = mediaMask(src, bitmap);
    bitmap.close();
    for (let index = 0; index < combined.length; index++) combined[index] |= value[index];
  }
  const response: DesktopPetMediaMaskResponse = { id, key, mask: combined.buffer };
  self.postMessage(response, { transfer: [response.mask] });
};
