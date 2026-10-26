import { DESKTOP_PET_BUILTINS } from './catalog';

/** Release availability shares the catalog; existing saved identities remain intact. */
export const RELEASED_DESKTOP_PETS = DESKTOP_PET_BUILTINS;

export function isDesktopPetReleased(id: string): boolean {
  return RELEASED_DESKTOP_PETS.some(character => character.id === id);
}
