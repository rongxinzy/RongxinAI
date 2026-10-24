import type { DesktopPetPlayableAction } from '../../shared/desktopPet/constants';
import { DesktopPetSequenceKind } from './sequenceClips';
import { DesktopPetSequencePlayer } from './sequencePlayer';

const QUIET_MS = 9_000;
const JITTER_MS = 14_000;
const IDLE_REPERTOIRE = [
  DesktopPetSequenceKind.Peek,
  DesktopPetSequenceKind.Nod,
  DesktopPetSequenceKind.Flutter,
  DesktopPetSequenceKind.Doze,
];

/** Quiet scheduling over authored clips, sampled by elapsed time. */
export class DesktopPetIdleActions {
  private readonly player = new DesktopPetSequencePlayer();
  private nextAt: number | undefined;
  private facing = 1;
  setFacing(value: number): void {
    this.facing = value >= 0 ? 1 : -1;
  }
  clear(): void {
    this.player.clear();
    this.nextAt = undefined;
  }
  play(kind: DesktopPetPlayableAction, now: number): void {
    this.player.play(kind, now);
    this.nextAt = now + 26_000 + Math.random() * JITTER_MS;
  }
  sample(now: number, active: boolean, count = 6, tempo = 1, energy = 1) {
    if (!active) this.clear();
    let result = this.player.sample(now, count, tempo, energy);
    if (active) {
      this.nextAt ??= now + QUIET_MS + Math.random() * JITTER_MS;
      if (!result.kind && now >= this.nextAt) {
        this.player.play(IDLE_REPERTOIRE[Math.floor(Math.random() * IDLE_REPERTOIRE.length)], now);
        this.nextAt = now + 26_000 + Math.random() * JITTER_MS;
        result = this.player.sample(now, count, tempo, energy);
      }
    }
    return {
      ...result,
      rotate: result.rotate * this.facing,
      offsetX: result.offsetX * this.facing,
    };
  }
}
