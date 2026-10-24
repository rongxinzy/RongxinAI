import { DesktopPetPlayableAction } from '../../shared/desktopPet/constants';

const IDLE_ACTION_MIN_MS = 9_000;
const IDLE_ACTION_JITTER_MS = 14_000;
const ACTION_MS = 900;

export const DesktopPetIdleKind = {
  None: 'none',
  Peek: DesktopPetPlayableAction.Peek,
  Nod: DesktopPetPlayableAction.Nod,
  Flutter: DesktopPetPlayableAction.Flutter,
  Happy: DesktopPetPlayableAction.Happy,
} as const;
export type DesktopPetIdleKind = (typeof DesktopPetIdleKind)[keyof typeof DesktopPetIdleKind];

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Procedural idle motion layered on top of the breathing spring. */
export class DesktopPetIdleActions {
  private nextAt = 0;
  private until = 0;
  private kind: DesktopPetIdleKind = DesktopPetIdleKind.None;
  private played = false;
  private facing = 1;

  setFacing(value: number): void {
    this.facing = value >= 0 ? 1 : -1;
  }

  /** Play an action immediately, overriding any in-progress idle motion. */
  play(kind: DesktopPetPlayableAction, now: number): void {
    this.kind = kind;
    this.played = true;
    this.until = now + ACTION_MS;
    this.nextAt =
      this.until + randomBetween(IDLE_ACTION_MIN_MS, IDLE_ACTION_MIN_MS + IDLE_ACTION_JITTER_MS);
    if (kind === DesktopPetIdleKind.Peek) this.facing *= -1;
  }

  sample(
    now: number,
    active: boolean,
  ): {
    rotate: number;
    offsetX: number;
    offsetY: number;
    greetingBoost: number;
  } {
    // On-demand plays keep rendering through drag/state changes; random idle stays suppressed.
    if (!active && !this.played) {
      this.kind = DesktopPetIdleKind.None;
      return { rotate: 0, offsetX: 0, offsetY: 0, greetingBoost: 0 };
    }
    if (active && this.kind === DesktopPetIdleKind.None && now >= this.nextAt) {
      const roll = Math.random();
      if (roll < 0.34) this.kind = DesktopPetIdleKind.Peek;
      else if (roll < 0.67) this.kind = DesktopPetIdleKind.Nod;
      else this.kind = DesktopPetIdleKind.Flutter;
      this.until = now + ACTION_MS;
      if (this.kind === DesktopPetIdleKind.Peek) this.facing *= -1;
    }
    if (this.kind !== DesktopPetIdleKind.None && now >= this.until) {
      this.kind = DesktopPetIdleKind.None;
      this.played = false;
      this.nextAt =
        now + randomBetween(IDLE_ACTION_MIN_MS, IDLE_ACTION_MIN_MS + IDLE_ACTION_JITTER_MS);
    }
    const progress =
      this.kind === DesktopPetIdleKind.None
        ? 0
        : Math.max(0, Math.min(1, 1 - (this.until - now) / ACTION_MS));
    const wave = Math.sin(progress * Math.PI);
    switch (this.kind) {
      case DesktopPetIdleKind.Peek:
        return {
          rotate: this.facing * 0.11 * wave,
          offsetX: this.facing * 7 * wave,
          offsetY: 0,
          greetingBoost: 0,
        };
      case DesktopPetIdleKind.Nod:
        return {
          rotate: 0,
          offsetX: 0,
          offsetY: -5 * wave,
          greetingBoost: 0,
        };
      case DesktopPetIdleKind.Flutter:
        return {
          rotate: this.facing * 0.05 * wave,
          offsetX: 0,
          offsetY: -3 * wave,
          greetingBoost: 0.55 * wave,
        };
      case DesktopPetIdleKind.Happy:
        return {
          rotate: this.facing * 0.06 * wave,
          offsetX: 0,
          offsetY: -9 * wave,
          greetingBoost: 0.7 * wave,
        };
      default:
        return { rotate: 0, offsetX: 0, offsetY: 0, greetingBoost: 0 };
    }
  }
}
