/** Poses are complete approved paintings; skinning never substitutes eyes, muzzle or ears. */
export function originalPose(id, clips) {
  if (id === clips.Think || id === clips.Preen) return 1;
  if (id === clips.Wait) return 2;
  if (id === clips.Happy || id === clips.Dance) return 3;
  if (id === clips.Concern) return 4;
  if (id === clips.Wave) return 5;
  if (id === clips.Blink || id === clips.Doze || id === clips.Wake) return 6;
  if (id === clips.Stretch || id === clips.Flutter) return 7;
  if (id === clips.Hop) return 11;
  return 0;
}

export const ORIGINAL_MOTION_RIGS = {
  youli: { id: 'youli', energy: 1, tailSwing: 0.13, walkCycles: 4 },
  tuantuan: { id: 'tuantuan', energy: 0.82, tailSwing: 0.07, walkCycles: 3 },
  mianmian: { id: 'mianmian', energy: 1, tailSwing: 0.04, walkCycles: 4 },
  zhuli: { id: 'zhuli', energy: 0.85, tailSwing: 0.13, walkCycles: 3 },
  yunmo: { id: 'yunmo', energy: 1, tailSwing: 0.1, walkCycles: 4, wings: true },
  maixiao: { id: 'maixiao', energy: 1.08, tailSwing: 0.32, walkCycles: 6 },
};
