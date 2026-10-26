import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { DESKTOP_PET_BUILTINS, DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { DESKTOP_PET_MOTIONS } from '../../shared/desktopPet/motionCatalog';

interface OriginalManifest {
  sourceSha256: string;
  size: number;
  fps: number;
  clips: Array<{
    id: string;
    seconds: number;
    frames: number;
    bytes: number;
    bounds: number[];
    sha256: string;
    maskSha256: string;
    posterSha256: string;
  }>;
}
const digest = (file: URL) => createHash('sha256').update(readFileSync(file)).digest('hex');

for (const pet of DESKTOP_PET_BUILTINS) {
  if (pet.id === DesktopPetBuiltinId.Xiaoyuan) continue;
  test(`${pet.id} preserves its original source and complete bounded transparent repertoire`, () => {
    const asset = (name: string) =>
      new URL(`../assets/desktop-pet/motion/${pet.id}-original/${name}`, import.meta.url);
    const manifest = JSON.parse(readFileSync(asset('manifest.json'), 'utf8')) as OriginalManifest;
    expect(digest(new URL(`../assets/desktop-pet/${pet.id}-atlas.png`, import.meta.url))).toBe(
      manifest.sourceSha256,
    );
    expect(manifest.size).toBe(512);
    expect(manifest.fps).toBe(30);
    expect(manifest.clips.map(clip => clip.id)).toEqual(DESKTOP_PET_MOTIONS.map(clip => clip.id));
    let total = 0;
    for (const [index, clip] of manifest.clips.entries()) {
      expect(clip.seconds).toBe(DESKTOP_PET_MOTIONS[index].seconds);
      expect(clip.frames).toBe(clip.seconds * 30);
      expect(readFileSync(asset(`${clip.id}.webm`)).length).toBe(clip.bytes);
      expect(clip.bytes).toBeLessThan(2 * 1024 * 1024);
      expect(digest(asset(`${clip.id}.webm`))).toBe(clip.sha256);
      expect(digest(asset(`${clip.id}-mask.png`))).toBe(clip.maskSha256);
      expect(digest(asset(`${clip.id}-poster.png`))).toBe(clip.posterSha256);
      expect(clip.bounds[0]).toBeGreaterThanOrEqual(4);
      expect(clip.bounds[1]).toBeGreaterThanOrEqual(4);
      expect(clip.bounds[2]).toBeLessThan(508);
      expect(clip.bounds[3]).toBeLessThan(508);
      total += clip.bytes;
    }
    expect(total).toBeLessThan(40 * 1024 * 1024);
  });
}
