import { expect, test } from 'vitest';
import { DESKTOP_PET_BUILTINS, DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { XIAOYUAN_ORIGINAL_MOTIONS } from '../../shared/desktopPet/motionCatalog';
import { desktopPetMediaPack } from './mediaPack';
import { desktopPetMediaSources } from './mediaSources';

test('Xiaoyuan has every declared original-art clip, mask and loading poster', () => {
  const pack = desktopPetMediaPack(DesktopPetBuiltinId.Xiaoyuan)!;
  expect(pack).not.toBeNull();
  expect(pack.map(clip => clip.id)).toEqual(XIAOYUAN_ORIGINAL_MOTIONS.map(clip => clip.id));
  const expected = DESKTOP_PET_BUILTINS.flatMap(character =>
    XIAOYUAN_ORIGINAL_MOTIONS.flatMap(clip =>
      ['.webm', '-mask.png', '-poster.png'].map(
        suffix => `../assets/desktop-pet/motion/${character.id}-original/${clip.id}${suffix}`,
      ),
    ),
  );
  expect(Object.keys(desktopPetMediaSources).sort()).toEqual(expected.sort());
  for (const clip of pack) {
    expect(clip.url).toContain('/motion/xiaoyuan-original/');
    expect(clip.maskUrl).toMatch(/-mask\.png(?:\?|$)/);
    expect(clip.posterUrl).toMatch(/-poster\.png(?:\?|$)/);
  }
});

test('all seven characters ship complete original-art packs without redrawn rigs', () => {
  expect(DESKTOP_PET_BUILTINS).toHaveLength(7);
  for (const character of DESKTOP_PET_BUILTINS) {
    const pack = desktopPetMediaPack(character.id)!;
    expect(pack).not.toBeNull();
    expect(pack.map(clip => clip.id)).toEqual(XIAOYUAN_ORIGINAL_MOTIONS.map(clip => clip.id));
    for (const clip of pack) expect(clip.url).toContain(`/motion/${character.id}-original/`);
  }
  expect(desktopPetMediaPack('unknown')).toBeNull();
});
