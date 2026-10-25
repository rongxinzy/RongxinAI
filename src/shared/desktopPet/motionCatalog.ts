export const DesktopPetMotion = {
  Idle: 'idle',
  Blink: 'blink',
  LookLeft: 'look-left',
  LookRight: 'look-right',
  Tilt: 'tilt',
  Nod: 'nod',
  Peek: 'peek',
  Flutter: 'flutter',
  Happy: 'happy',
  Stretch: 'stretch',
  Doze: 'doze',
  Wake: 'wake',
  Think: 'think',
  Wait: 'wait',
  Concern: 'concern',
  Wave: 'wave',
  Walk: 'walk',
  Lift: 'lift',
  Land: 'land',
  Listen: 'listen',
  Bow: 'bow',
  Preen: 'preen',
  Hop: 'hop',
  Dance: 'dance',
} as const;
export type DesktopPetMotion = (typeof DesktopPetMotion)[keyof typeof DesktopPetMotion];

/** Authored clip durations are build inputs; playback completion comes from media events. */
export const DESKTOP_PET_MOTIONS = [
  { id: DesktopPetMotion.Idle, seconds: 4, loop: true },
  { id: DesktopPetMotion.Blink, seconds: 3, loop: false },
  { id: DesktopPetMotion.LookLeft, seconds: 5, loop: false },
  { id: DesktopPetMotion.LookRight, seconds: 5, loop: false },
  { id: DesktopPetMotion.Tilt, seconds: 5, loop: false },
  { id: DesktopPetMotion.Nod, seconds: 5, loop: false },
  { id: DesktopPetMotion.Peek, seconds: 8, loop: false },
  { id: DesktopPetMotion.Flutter, seconds: 8, loop: false },
  { id: DesktopPetMotion.Happy, seconds: 7, loop: false },
  { id: DesktopPetMotion.Stretch, seconds: 8, loop: false },
  { id: DesktopPetMotion.Doze, seconds: 10, loop: false },
  { id: DesktopPetMotion.Wake, seconds: 6, loop: false },
  { id: DesktopPetMotion.Think, seconds: 6, loop: true },
  { id: DesktopPetMotion.Wait, seconds: 6, loop: true },
  { id: DesktopPetMotion.Concern, seconds: 6, loop: true },
  { id: DesktopPetMotion.Wave, seconds: 7, loop: false },
  { id: DesktopPetMotion.Walk, seconds: 4, loop: true },
  { id: DesktopPetMotion.Lift, seconds: 4, loop: true },
  { id: DesktopPetMotion.Land, seconds: 3, loop: false },
  { id: DesktopPetMotion.Listen, seconds: 8, loop: false },
  { id: DesktopPetMotion.Bow, seconds: 6, loop: false },
  { id: DesktopPetMotion.Preen, seconds: 9, loop: false },
  { id: DesktopPetMotion.Hop, seconds: 5, loop: false },
  { id: DesktopPetMotion.Dance, seconds: 9, loop: false },
] as const;

export const DESKTOP_PET_MEDIA_FPS = 30;
export const DESKTOP_PET_MEDIA_SIZE = 512;

// The restored head/feet and repaired wing anatomy now have a complete authored repertoire.
export const XIAOYUAN_ORIGINAL_MOTIONS = DESKTOP_PET_MOTIONS;
