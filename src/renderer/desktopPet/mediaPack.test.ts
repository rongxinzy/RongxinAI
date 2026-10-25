import { expect, test } from 'vitest';
import { DESKTOP_PET_BUILTINS, DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import {
  DESKTOP_PET_MOTIONS,
  XIAOYUAN_ORIGINAL_MOTIONS,
} from '../../shared/desktopPet/motionCatalog';
import { desktopPetMediaPack } from './mediaPack';

test('every bundled companion has its complete declared repertoire without mixing Xiaoyuan artwork', () => {
  for (const character of DESKTOP_PET_BUILTINS) {
    const pack = desktopPetMediaPack(character.id)!;
    expect(pack, character.id).not.toBeNull();
    const catalog =
      character.id === DesktopPetBuiltinId.Xiaoyuan
        ? XIAOYUAN_ORIGINAL_MOTIONS
        : DESKTOP_PET_MOTIONS;
    expect(pack.map(clip => clip.id)).toEqual(catalog.map(clip => clip.id));
    for (const clip of pack) {
      expect(clip.url).toMatch(/\.webm(?:\?|$)/);
      expect(clip.maskUrl).toMatch(/-mask\.png(?:\?|$)/);
      expect(clip.posterUrl).toMatch(/-poster\.png(?:\?|$)/);
      if (character.id === DesktopPetBuiltinId.Xiaoyuan)
        expect(clip.url).toContain('/motion/xiaoyuan-original/');
    }
  }
  expect(desktopPetMediaPack('unknown')).toBeNull();
});
