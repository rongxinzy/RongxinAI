import { expect, test } from 'vitest';
import { DESKTOP_PET_BUILTINS } from '../../shared/desktopPet/catalog';
import { DESKTOP_PET_MOTIONS } from '../../shared/desktopPet/motionCatalog';
import { desktopPetMediaPack } from './mediaPack';

test('all seven bundled companions contain every authored clip, mask and poster', () => {
  for (const character of DESKTOP_PET_BUILTINS) {
    const pack = desktopPetMediaPack(character.id)!;
    expect(pack, character.id).not.toBeNull();
    expect(pack.map(clip => clip.id)).toEqual(DESKTOP_PET_MOTIONS.map(clip => clip.id));
    for (const clip of pack) {
      expect(clip.url).toMatch(/\.webm(?:\?|$)/);
      expect(clip.maskUrl).toMatch(/-mask\.png(?:\?|$)/);
      expect(clip.posterUrl).toMatch(/-poster\.png(?:\?|$)/);
    }
  }
  expect(desktopPetMediaPack('unknown')).toBeNull();
});
