import { createCanvas, loadImage } from '@napi-rs/canvas';

/** Independent mask decode checks all-frame authored bounds without reading application state. */
export async function verifyMotionMask(file, size, recordedBounds) {
  const image = await loadImage(file);
  if (image.width !== size || image.height !== size)
    throw new Error('Invalid motion mask dimensions');
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, size, size).data;
  const bounds = [size, size, -1, -1];
  let covered = 0;
  for (let index = 0; index < size * size; index++) {
    const alpha = pixels[index * 4 + 3];
    if (alpha !== 0 && alpha !== 255)
      throw new Error('Motion mask is not an authored binary union');
    if (!alpha) continue;
    const x = index % size,
      y = Math.floor(index / size);
    bounds[0] = Math.min(bounds[0], x);
    bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x);
    bounds[3] = Math.max(bounds[3], y);
    covered++;
  }
  if (
    covered < 256 ||
    bounds[0] < 4 ||
    bounds[1] < 4 ||
    bounds[2] >= size - 4 ||
    bounds[3] >= size - 4
  )
    throw new Error('Authored motion is blank or touches the canvas edge');
  if (recordedBounds && JSON.stringify(recordedBounds) !== JSON.stringify(bounds))
    throw new Error('Motion mask bounds do not match the authored record');
  return bounds;
}
