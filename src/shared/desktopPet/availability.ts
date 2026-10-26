import { DESKTOP_PET_BUILTINS, DesktopPetBuiltinId } from './catalog';

/** Release availability only; dormant characters, artwork and saved identities remain intact. */
export const RELEASED_DESKTOP_PETS = DESKTOP_PET_BUILTINS.filter(
  character => character.id === DesktopPetBuiltinId.Xiaoyuan,
);

export function isDesktopPetReleased(id: string): boolean {
  return RELEASED_DESKTOP_PETS.some(character => character.id === id);
}
