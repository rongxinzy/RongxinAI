import { test, expect } from 'vitest';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { DesktopPetAtlas } from './atlas';

test('a late atlas decode cannot replace a newer character selection', async () => {
  const pending: Array<(image: HTMLImageElement) => void> = [];
  const atlas = new DesktopPetAtlas(() => new Promise(resolve => pending.push(resolve)));
  const first = atlas.select(DesktopPetBuiltinId.Youli);
  const second = atlas.select(DesktopPetBuiltinId.Yunmo);
  const image = {} as HTMLImageElement;
  pending[1](image);
  expect(await second).toBe(true);
  pending[0]({} as HTMLImageElement);
  expect(await first).toBe(false);
  expect(atlas.character.id).toBe(DesktopPetBuiltinId.Yunmo);
  expect(atlas.image).toBe(image);
});

test('a failed character switch preserves the previous decoded character and allows retry', async () => {
  let failed = false;
  const image = {} as HTMLImageElement;
  const atlas = new DesktopPetAtlas(async () => {
    if (failed) throw new Error('decode failed');
    return image;
  });
  await atlas.select(DesktopPetBuiltinId.Xiaoyuan);
  failed = true;
  expect(await atlas.select(DesktopPetBuiltinId.Youli)).toBe(false);
  expect(atlas.character.id).toBe(DesktopPetBuiltinId.Xiaoyuan);
  expect(atlas.image).toBe(image);
  failed = false;
  expect(await atlas.select(DesktopPetBuiltinId.Youli)).toBe(true);
});
