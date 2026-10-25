import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import manifest from '../assets/desktop-pet/motion/xiaoyuan-original/manifest.json';
import {
  DESKTOP_PET_MEDIA_FPS,
  DESKTOP_PET_MEDIA_SIZE,
  XIAOYUAN_ORIGINAL_MOTIONS,
} from '../../shared/desktopPet/motionCatalog';

const asset = (name: string) =>
  new URL(`../assets/desktop-pet/motion/xiaoyuan-original/${name}`, import.meta.url);
const digest = (file: URL) => createHash('sha256').update(readFileSync(file)).digest('hex');

test('the original face and every exported clip match their recorded source and hashes', () => {
  expect(digest(new URL('../assets/desktop-pet/xiaoyuan-atlas.png', import.meta.url))).toBe(
    manifest.sourceSha256,
  );
  expect(manifest.size).toBe(DESKTOP_PET_MEDIA_SIZE);
  expect(manifest.fps).toBe(DESKTOP_PET_MEDIA_FPS);
  expect(manifest.clips.map(clip => clip.id)).toEqual(
    XIAOYUAN_ORIGINAL_MOTIONS.map(clip => clip.id),
  );
  for (const [index, clip] of manifest.clips.entries()) {
    expect(clip.seconds, clip.id).toBe(XIAOYUAN_ORIGINAL_MOTIONS[index].seconds);
    expect(clip.frames, clip.id).toBe(clip.seconds * DESKTOP_PET_MEDIA_FPS);
    const video = asset(`${clip.id}.webm`);
    expect(readFileSync(video).byteLength, clip.id).toBe(clip.bytes);
    expect(digest(video), clip.id).toBe(clip.sha256);
    expect(digest(asset(`${clip.id}-mask.png`)), clip.id).toBe(clip.maskSha256);
    expect(digest(asset(`${clip.id}-poster.png`)), clip.id).toBe(clip.posterSha256);
  }
});
