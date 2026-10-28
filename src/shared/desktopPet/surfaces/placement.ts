import { DESKTOP_PET_SIZE } from '../constants';
import { DESKTOP_PET_CANVAS_TOP, DESKTOP_PET_WINDOW_HEIGHT } from '../layout';
import { PetOrientation, WindowSurfaceSide } from './constants';
import type { SurfacePoint, SurfaceRect } from './types';

export function surfaceOrientation(side: WindowSurfaceSide): PetOrientation {
  return side === WindowSurfaceSide.Top
    ? PetOrientation.Upright
    : side === WindowSurfaceSide.Left
      ? PetOrientation.Left
      : PetOrientation.Right;
}
function anchor(orientation: PetOrientation): SurfacePoint {
  return {
    x:
      orientation === PetOrientation.Upright
        ? DESKTOP_PET_SIZE / 2
        : orientation === PetOrientation.Left
          ? DESKTOP_PET_SIZE - 12
          : 12,
    y:
      DESKTOP_PET_CANVAS_TOP +
      (orientation === PetOrientation.Upright ? DESKTOP_PET_SIZE - 12 : DESKTOP_PET_SIZE / 2),
  };
}
export function surfaceWindowPosition(
  foot: SurfacePoint,
  orientation: PetOrientation,
): SurfacePoint {
  const offset = anchor(orientation);
  return { x: foot.x - offset.x, y: foot.y - offset.y };
}
export function surfaceFoot(position: SurfacePoint, orientation: PetOrientation): SurfacePoint {
  const offset = anchor(orientation);
  return { x: position.x + offset.x, y: position.y + offset.y };
}
/** Every contact point that keeps the whole window inside a work area for this orientation. */
export function surfaceContactArea(orientation: PetOrientation, area: SurfaceRect): SurfaceRect {
  const offset = anchor(orientation);
  return {
    x: area.x + offset.x,
    y: area.y + offset.y,
    width: area.width - DESKTOP_PET_SIZE,
    height: area.height - DESKTOP_PET_WINDOW_HEIGHT,
  };
}

export function surfacePositionFits(position: SurfacePoint, area: SurfaceRect): boolean {
  return (
    position.x >= area.x &&
    position.y >= area.y &&
    position.x + DESKTOP_PET_SIZE <= area.x + area.width &&
    position.y + DESKTOP_PET_WINDOW_HEIGHT <= area.y + area.height
  );
}
