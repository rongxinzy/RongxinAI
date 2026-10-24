import { desktopPetPoseIndex } from '../../shared/desktopPet/catalog';
import { DESKTOP_PET_CLIPS, type DesktopPetSequenceKind } from './sequenceClips';

export class DesktopPetSequencePlayer {
  private startedAt = 0;
  private kind: DesktopPetSequenceKind | null = null;

  play(kind: DesktopPetSequenceKind, now: number): void {
    this.kind = kind;
    this.startedAt = now;
  }

  clear(): void {
    this.kind = null;
  }

  sample(now: number, count: number, tempo = 1, energy = 1) {
    const neutral = {
      weights: Array<number>(count).fill(0),
      influence: 0,
      rotate: 0,
      offsetX: 0,
      offsetY: 0,
      stretch: 1,
      kind: null as DesktopPetSequenceKind | null,
      progress: 0,
    };
    if (!this.kind) return neutral;
    const clip = DESKTOP_PET_CLIPS[this.kind];
    const elapsed = Math.max(0, (now - this.startedAt) * tempo);
    const duration = clip[clip.length - 1].at;
    if (elapsed >= duration) {
      this.clear();
      return neutral;
    }
    const next = clip.findIndex(frame => frame.at > elapsed);
    const a = clip[Math.max(0, next - 1)];
    const b = clip[next];
    const t = (elapsed - a.at) / (b.at - a.at);
    const eased = t * t * (3 - 2 * t);
    const lerp = (from: number, to: number) => from + (to - from) * eased;
    const weights = Array<number>(count).fill(0);
    // Keep expressions readable during long holds; dissolve only at a pose boundary.
    const blend = Math.max(0, Math.min(1, (elapsed - b.at + 140) / 140));
    const poseMix = blend * blend * (3 - 2 * blend);
    weights[desktopPetPoseIndex(a.sprite, count)] += 1 - poseMix;
    weights[desktopPetPoseIndex(b.sprite, count)] += poseMix;
    return {
      weights,
      influence: lerp(a.influence, b.influence),
      rotate: lerp(a.rotate, b.rotate) * energy,
      offsetX: lerp(a.x, b.x) * energy,
      offsetY: lerp(a.y, b.y) * energy,
      stretch: 1 + (lerp(a.stretch, b.stretch) - 1) * energy,
      kind: this.kind,
      progress: elapsed / duration,
    };
  }
}
