import { desktopPetBuiltin } from '../../shared/desktopPet/catalog';
import { DESKTOP_PET_MOTIONS, type DesktopPetMotion } from '../../shared/desktopPet/motionCatalog';

export interface DesktopPetMediaClip {
  id: DesktopPetMotion;
  url: string;
  maskUrl: string;
  posterUrl: string;
  loop: boolean;
}

// Only bundled, authored media. No external URLs or model-supplied media paths.
const sources = import.meta.glob<string>('../assets/desktop-pet/motion/*/*.{webm,png}', {
  eager: true,
  query: '?url',
  import: 'default',
});
export function desktopPetMediaPack(characterId: string): DesktopPetMediaClip[] | null {
  if (!desktopPetBuiltin(characterId)) return null;
  const root = `../assets/desktop-pet/motion/${characterId}/`;
  const pack = DESKTOP_PET_MOTIONS.flatMap(clip => {
    const url = sources[`${root}${clip.id}.webm`];
    const maskUrl = sources[`${root}${clip.id}-mask.png`];
    const posterUrl = sources[`${root}${clip.id}-poster.png`];
    return url && maskUrl && posterUrl ? [{ ...clip, url, maskUrl, posterUrl }] : [];
  });
  // Incomplete authoring output must keep the static-state fallback, never a partial repertoire.
  return pack.length === DESKTOP_PET_MOTIONS.length ? pack : null;
}
