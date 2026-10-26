import { DesktopPetBuiltinId, desktopPetBuiltin } from '../../shared/desktopPet/catalog';
import { desktopPetMediaSources } from '@/desktopPet/mediaSources';
import {
  DESKTOP_PET_MOTIONS,
  XIAOYUAN_ORIGINAL_MOTIONS,
  type DesktopPetMotion,
} from '../../shared/desktopPet/motionCatalog';

export interface DesktopPetMediaClip {
  id: DesktopPetMotion;
  url: string;
  maskUrl: string;
  posterUrl: string;
  loop: boolean;
}

// Only bundled, authored media. No external URLs or model-supplied media paths.
export function desktopPetMediaPack(characterId: string): DesktopPetMediaClip[] | null {
  if (!desktopPetBuiltin(characterId)) return null;
  // Every released pack preserves its original atlas identity, including Xiaoyuan.
  const canonical = characterId === DesktopPetBuiltinId.Xiaoyuan;
  const root = `../assets/desktop-pet/motion/${characterId}-original/`;
  const repertoire = canonical ? XIAOYUAN_ORIGINAL_MOTIONS : DESKTOP_PET_MOTIONS;
  const pack = repertoire.flatMap(clip => {
    const url = desktopPetMediaSources[`${root}${clip.id}.webm`];
    const maskUrl = desktopPetMediaSources[`${root}${clip.id}-mask.png`];
    const posterUrl = desktopPetMediaSources[`${root}${clip.id}-poster.png`];
    return url && maskUrl && posterUrl ? [{ ...clip, url, maskUrl, posterUrl }] : [];
  });
  // A missing file invalidates the declared repertoire rather than silently accepting damage.
  return pack.length === repertoire.length ? pack : null;
}
