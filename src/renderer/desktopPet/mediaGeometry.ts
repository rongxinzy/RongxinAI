import { DESKTOP_PET_SIZE } from '../../shared/desktopPet/constants';

export function drawPetMedia(
  target: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  scaleY = 1,
  facing = 1,
  rotate = 0,
  offsetX = 0,
  offsetY = 0,
): void {
  target.save();
  target.translate(DESKTOP_PET_SIZE / 2 + offsetX, DESKTOP_PET_SIZE - 12 + offsetY);
  target.rotate(rotate);
  target.scale(facing / Math.sqrt(scaleY), scaleY);
  target.drawImage(
    source,
    -DESKTOP_PET_SIZE / 2,
    -(DESKTOP_PET_SIZE - 12),
    DESKTOP_PET_SIZE,
    DESKTOP_PET_SIZE,
  );
  target.restore();
}
