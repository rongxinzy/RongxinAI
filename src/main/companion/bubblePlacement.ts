import { CompanionBubbleSide } from '../../shared/companion/bubble';
import { DESKTOP_PET_CANVAS_TOP } from '../../shared/desktopPet/layout';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, Math.max(min, max)));

/** All positions are Electron DIP, so mixed scale factors never enter the attachment math. */
export function companionBubblePlacement(anchor: Rect, area: Rect) {
  const width = Math.min(480, area.width - 16);
  const height = Math.min(400, area.height - 16);
  const center = anchor.x + anchor.width / 2;
  const head = anchor.y + (anchor.height ? DESKTOP_PET_CANVAS_TOP : 0);
  const above = head - height - 8;
  const below = anchor.y + anchor.height + 8;
  const side =
    above >= area.y + 8 || above - area.y > area.y + area.height - below - height
      ? CompanionBubbleSide.Above
      : CompanionBubbleSide.Below;
  const x = Math.round(clamp(center - width / 2, area.x + 8, area.x + area.width - width - 8));
  const y = Math.round(
    clamp(
      side === CompanionBubbleSide.Above ? above : below,
      area.y + 8,
      area.y + area.height - height - 8,
    ),
  );
  return {
    bounds: { x, y, width, height },
    placement: { side, anchorX: clamp(center - x, 24, width - 24) },
  };
}
