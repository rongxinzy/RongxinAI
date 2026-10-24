export const DesktopPetBuiltinId = {
  Xiaoyuan: 'xiaoyuan',
  Youli: 'youli',
  Tuantuan: 'tuantuan',
  Mianmian: 'mianmian',
  Zhuli: 'zhuli',
  Yunmo: 'yunmo',
  Maixiao: 'maixiao',
} as const;
export type DesktopPetBuiltinId = (typeof DesktopPetBuiltinId)[keyof typeof DesktopPetBuiltinId];

export const DESKTOP_PET_BUILTINS = [
  {
    id: DesktopPetBuiltinId.Xiaoyuan,
    nameKey: 'desktopPetCharacterXiaoyuan',
    columns: 3,
    rows: 2,
    tempo: 1,
    energy: 1,
  },
  {
    id: DesktopPetBuiltinId.Youli,
    nameKey: 'desktopPetCharacterYouli',
    columns: 4,
    rows: 3,
    tempo: 1.08,
    energy: 1.05,
  },
  {
    id: DesktopPetBuiltinId.Tuantuan,
    nameKey: 'desktopPetCharacterTuantuan',
    columns: 4,
    rows: 3,
    tempo: 0.92,
    energy: 0.85,
  },
  {
    id: DesktopPetBuiltinId.Mianmian,
    nameKey: 'desktopPetCharacterMianmian',
    columns: 4,
    rows: 3,
    tempo: 1,
    energy: 1.1,
  },
  {
    id: DesktopPetBuiltinId.Zhuli,
    nameKey: 'desktopPetCharacterZhuli',
    columns: 4,
    rows: 3,
    tempo: 0.9,
    energy: 0.9,
  },
  {
    id: DesktopPetBuiltinId.Yunmo,
    nameKey: 'desktopPetCharacterYunmo',
    columns: 4,
    rows: 3,
    tempo: 0.96,
    energy: 1,
  },
  {
    id: DesktopPetBuiltinId.Maixiao,
    nameKey: 'desktopPetCharacterMaixiao',
    columns: 4,
    rows: 3,
    tempo: 1.12,
    energy: 1.1,
  },
] as const;

export function desktopPetBuiltin(id: string) {
  return DESKTOP_PET_BUILTINS.find(pack => pack.id === id);
}

/** The original owl keeps its six poses; new characters add six expressive poses. */
export const DesktopPetPoseIndex = {
  Idle: 0,
  Thinking: 1,
  Waiting: 2,
  Completed: 3,
  Error: 4,
  Greeting: 5,
  Blink: 6,
  Stretch: 7,
  Sleep: 8,
  Alert: 9,
  Crouch: 10,
  Leap: 11,
} as const;

const SIX_POSE_FALLBACKS = [0, 1, 2, 3, 4, 5, 0, 5, 0, 1, 1, 3];
export function desktopPetPoseIndex(index: number, count: number): number {
  return index < count ? index : (SIX_POSE_FALLBACKS[index] ?? 0);
}
