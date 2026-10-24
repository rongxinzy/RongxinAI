import { DesktopPetPoseIndex as P } from '../../shared/desktopPet/catalog';
import { DesktopPetPlayableAction as A } from '../../shared/desktopPet/constants';

export const DesktopPetSequenceKind = { ...A, Doze: 'doze' } as const;
export type DesktopPetSequenceKind =
  (typeof DesktopPetSequenceKind)[keyof typeof DesktopPetSequenceKind];

export interface PetKeyframe {
  at: number;
  sprite: number;
  x: number;
  y: number;
  rotate: number;
  stretch: number;
  influence: number;
}

function pose(
  at: number,
  sprite: number = P.Idle,
  x = 0,
  y = 0,
  rotate = 0,
  stretch = 1,
  influence = 1,
): PetKeyframe {
  return { at, sprite, x, y, rotate, stretch, influence };
}
const rest = (at: number) => pose(at, P.Idle, 0, 0, 0, 1, 0);

/** Authored beats: anticipate, perform, hold, follow through, then return to the live state. */
export const DESKTOP_PET_CLIPS: Record<DesktopPetSequenceKind, readonly PetKeyframe[]> = {
  [A.Peek]: [
    rest(0),
    pose(650, P.Thinking, -2, 0, -0.04),
    pose(1700, P.Alert, -7, -2, -0.12),
    pose(2800, P.Alert, -7, -2, -0.12),
    pose(3100, P.Blink, -5, 0, -0.04),
    pose(4400, P.Alert, 7, -2, 0.12),
    pose(5700, P.Thinking, 5, 0, 0.07),
    pose(6800, P.Greeting, 0, -3, 0.02),
    rest(8200),
  ],
  [A.Nod]: [
    rest(0),
    pose(900, P.Thinking, 0, 0, -0.06),
    pose(1500, P.Blink, 0, 5, 0.03, 0.94),
    pose(2150, P.Thinking, 0, -3, -0.03, 1.03),
    pose(2800, P.Blink, 0, 5, 0.03, 0.94),
    pose(3500, P.Greeting, 0, -3, -0.03),
    pose(4400, P.Greeting, 0, 0, 0.04),
    rest(7000),
  ],
  [A.Flutter]: [
    rest(0),
    pose(700, P.Crouch, 0, 5, 0, 0.9),
    pose(1900, P.Stretch, 0, -5, -0.03, 1.06),
    pose(3100, P.Stretch, 0, -5, 0.04, 1.06),
    pose(4200, P.Stretch, 0, -4, -0.03, 1.04),
    pose(5200, P.Blink, 0, 3, 0, 0.95),
    pose(6100, P.Greeting, 0, -2, 0.04),
    rest(7600),
  ],
  [A.Happy]: [
    rest(0),
    pose(500, P.Crouch, 0, 5, -0.04, 0.9),
    pose(1000, P.Leap, -4, -16, -0.12, 1.05),
    pose(1500, P.Completed, 0, -7, 0.05),
    pose(1900, P.Crouch, 2, 5, 0.04, 0.91),
    pose(2800, P.Greeting, 3, -4, -0.1),
    pose(3500, P.Leap, 5, -13, 0.1, 1.04),
    pose(4100, P.Completed, 0, 1, -0.03, 0.95),
    pose(5000, P.Greeting, 0, -2, 0.07),
    rest(7000),
  ],
  [DesktopPetSequenceKind.Doze]: [
    rest(0),
    pose(1300, P.Blink, 0, 1, -0.03),
    pose(3000, P.Sleep, 0, 5, -0.06, 0.94),
    pose(6800, P.Sleep, 0, 5, -0.06, 0.94),
    pose(8500, P.Alert, 0, -3, 0.06),
    pose(10100, P.Stretch, 0, -4, -0.04, 1.04),
    pose(11500, P.Blink, 0, 2),
    rest(13000),
  ],
};
