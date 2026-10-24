import { useEffect, useRef } from 'react';
import { DesktopPetAtlas } from '../desktopPet/atlas';
import { drawPetPose } from '../desktopPet/draw';
import { DESKTOP_PET_SIZE } from '../../shared/desktopPet/constants';
import { DesktopPetPoseIndex } from '../../shared/desktopPet/catalog';

/** Static, original character artwork; no video decoder or idle animation in the page. */
export function CompanionPortrait({ characterId, label }: { characterId: string; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    const view = canvas.current;
    const context = view?.getContext('2d');
    if (!view || !context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, view.width, view.height);
    const atlas = new DesktopPetAtlas();
    void atlas
      .select(characterId)
      .then(() => {
        if (!active) return;
        context.setTransform(
          view.width / DESKTOP_PET_SIZE,
          0,
          0,
          view.height / DESKTOP_PET_SIZE,
          0,
          0,
        );
        drawPetPose(context, atlas, DesktopPetPoseIndex.Idle);
      })
      .catch(() => {
        /* The name selector remains usable without artwork. */
      });
    return () => {
      active = false;
    };
  }, [characterId]);
  return (
    <canvas
      ref={canvas}
      width={96}
      height={96}
      className="size-12 shrink-0"
      role="img"
      aria-label={label}
      data-companion-portrait={characterId}
    />
  );
}
