import { expect, test } from 'vitest';
import { PetOrientation } from '../../shared/desktopPet/surfaces/constants';
import { orientPetMask } from './orientation';

test('wall pixel masks rotate with the canvas without mutating the shared source', () => {
  const mask = new Uint8Array(192 * 192);
  mask[180 * 192 + 96] = 255;
  mask[5 * 192 + 20] = 128;
  const left = orientPetMask(mask, PetOrientation.Left);
  const right = orientPetMask(mask, PetOrientation.Right);
  expect(left[95 * 192 + 180]).toBe(255);
  expect(right[96 * 192 + 11]).toBe(255);
  expect([...left].filter(Boolean)).toHaveLength(2);
  expect(orientPetMask(left, PetOrientation.Right)).toEqual(mask);
  expect(orientPetMask(right, PetOrientation.Left)).toEqual(mask);
  expect(mask[180 * 192 + 96]).toBe(255);
});
