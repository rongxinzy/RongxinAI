import { DESKTOP_PET_SIZE } from '../../shared/desktopPet/constants';
import { PetOrientation } from '../../shared/desktopPet/surfaces/constants';

/** A quarter-turn around the canvas centre maps the existing feet to the wall contact. */
export function applyPetOrientation(
  context: CanvasRenderingContext2D,
  orientation: PetOrientation,
): void {
  if (orientation === PetOrientation.Upright) return;
  const centre = DESKTOP_PET_SIZE / 2;
  context.translate(centre, centre);
  context.rotate(orientation === PetOrientation.Left ? -Math.PI / 2 : Math.PI / 2);
  context.translate(-centre, -centre);
}

export function orientPetMask(mask: Uint8Array, orientation: PetOrientation): Uint8Array {
  if (orientation === PetOrientation.Upright) return mask;
  const rotated = new Uint8Array(mask.length);
  for (let y = 0; y < DESKTOP_PET_SIZE; y++)
    for (let x = 0; x < DESKTOP_PET_SIZE; x++) {
      const nextX = orientation === PetOrientation.Left ? y : DESKTOP_PET_SIZE - 1 - y;
      const nextY = orientation === PetOrientation.Left ? DESKTOP_PET_SIZE - 1 - x : x;
      rotated[nextY * DESKTOP_PET_SIZE + nextX] = mask[y * DESKTOP_PET_SIZE + x];
    }
  return rotated;
}
