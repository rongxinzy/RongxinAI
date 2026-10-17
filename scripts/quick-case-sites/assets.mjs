import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assetsDir } from './context.mjs';

const imageCache = new Map();
export function imageData(name) {
  if (!name) return '';
  const assetName = name === 'camera' ? 'camera-launch' : name === 'coast' ? 'coast-house' : name;
  if (!imageCache.has(assetName)) {
    const file = join(assetsDir, `${assetName}.jpg`);
    imageCache.set(assetName, `data:image/jpeg;base64,${readFileSync(file).toString('base64')}`);
  }
  return imageCache.get(assetName);
}
