import { expect, test } from 'vitest';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { DESKTOP_PET_MOTIONS } from '../../shared/desktopPet/motionCatalog';
import { desktopPetMediaPack } from './mediaPack';

test('the bundled owl pack contains every authored clip and its mask and poster', () => {
  const pack = desktopPetMediaPack(DesktopPetBuiltinId.Xiaoyuan)!;
  expect(pack.map(clip => clip.id)).toEqual(DESKTOP_PET_MOTIONS.map(clip => clip.id));
  for (const clip of pack) {
    expect(clip.url).toMatch(/\.webm(?:\?|$)/);
    expect(clip.maskUrl).toMatch(/-mask\.png(?:\?|$)/);
    expect(clip.posterUrl).toMatch(/-poster\.png(?:\?|$)/);
  }
  expect(desktopPetMediaPack(DesktopPetBuiltinId.Youli)).toBeNull();
});
