import { test, expect } from 'vitest';
import { DESKTOP_PET_BUILTINS } from '../../shared/desktopPet/catalog';
import { DESKTOP_PET_CLIPS, DesktopPetSequenceKind } from './sequenceClips';
import { DesktopPetSequencePlayer } from './sequencePlayer';

test('every character and clip keeps normalized poses, bounded geometry and a neutral ending', () => {
  for (const character of DESKTOP_PET_BUILTINS) {
    for (const kind of Object.values(DesktopPetSequenceKind)) {
      const player = new DesktopPetSequencePlayer();
      player.play(kind, 0);
      const duration = DESKTOP_PET_CLIPS[kind].at(-1)!.at / character.tempo;
      expect(duration).toBeGreaterThan(6000);
      expect(duration).toBeLessThan(15000);
      for (let now = 0; now < duration; now += 31) {
        const pose = player.sample(
          now,
          character.columns * character.rows,
          character.tempo,
          character.energy,
        );
        expect(pose.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
        expect(pose.weights.every(weight => weight >= 0)).toBe(true);
        expect(Math.abs(pose.offsetX)).toBeLessThanOrEqual(8);
        expect(Math.abs(pose.offsetY)).toBeLessThanOrEqual(18);
        expect(Math.abs(pose.rotate)).toBeLessThan(0.16);
        expect(pose.stretch).toBeGreaterThan(0.86);
        expect(pose.stretch).toBeLessThan(1.13);
      }
      expect(player.sample(duration + 1, 12, character.tempo).influence).toBe(0);
    }
  }
});

test('sequence timing is independent of frame rate and supports the original six-pose owl', () => {
  const run = (hz: number, count: number) => {
    const player = new DesktopPetSequencePlayer();
    player.play(DesktopPetSequenceKind.Happy, 0);
    for (let frame = 0; frame <= hz * 3; frame++) player.sample((frame * 1000) / hz, count);
    return player.sample(3500, count);
  };
  expect(run(60, 12)).toEqual(run(120, 12));
  const owl = run(60, 6);
  expect(owl.weights).toHaveLength(6);
  expect(owl.weights[3]).toBe(1);
});
